import express from 'express';
import {
  App,
  SlackEventMiddlewareArgs,
  AllMiddlewareArgs,
  GenericMessageEvent,
} from '@slack/bolt';
import dotenv from 'dotenv';
import { CronJob } from 'cron';
import { MESSAGE_BLOCKS } from './constants';
import { format } from 'date-fns'; // you can use `new Date().toISOString().split("T")[0]` if avoiding extra packages
import { standupThreadsByDate } from './tandupThreads';

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN!,
});

const expressApp = express();
const channelId = process.env.CHANNEL_ID!;

// In-memory storage for standup updates
interface StandupUpdate {
  text: string;
  timestamp: string;
}

type UpdatesMap = Record<
  string, // thread_ts
  {
    date: string; // formatted like "2025-05-20"
    updatesByUser: Record<string, StandupUpdate[]>;
  }
>;

const standups: UpdatesMap = {};

let currentStandupThreadTs: string | null = null;

// Daily standup reminder (09:00 Africa/Cairo)
const job = new CronJob(
  '0 9 * * *',
  async () => {
    try {
      const result = await app.client.chat.postMessage({
        channel: channelId,
        text: `Good morning, team! :sunny:\n\nIt's time for our daily standup. Please reply in this thread with your updates:\n• What did you accomplish yesterday?\n• What are your plans for today?\n• Any blockers or challenges?`,
        blocks: MESSAGE_BLOCKS,
      });
      currentStandupThreadTs = result.ts || null;
      console.log('✅ Sent standup reminder');
    } catch (err) {
      console.error('❌ Error sending standup reminder:', err);
    }
  },
  null,
  true,
  'Africa/Cairo'
);

app.message(
  async (args: SlackEventMiddlewareArgs<'message'> & AllMiddlewareArgs) => {
    const { message, say } = args;
    const msg = message as GenericMessageEvent;

    if (
      msg.channel === channelId &&
      msg.user &&
      msg.thread_ts &&
      msg.thread_ts !== msg.ts
    ) {
      const dateKey = format(new Date(parseFloat(msg.thread_ts) * 1000), 'yyyy-MM-dd');

      if (!standups[msg.thread_ts]) {
        standups[msg.thread_ts] = {
          date: dateKey,
          updatesByUser: {},
        };
      }

      const thread = standups[msg.thread_ts];

      if (!thread.updatesByUser[msg.user]) {
        thread.updatesByUser[msg.user] = [];
      }

      thread.updatesByUser[msg.user].push({
        text: msg.text || '',
        timestamp: msg.ts,
      });

      await say({
        thread_ts: msg.thread_ts,
        text: `Thanks for the update, <@${msg.user}>!`,
      });
    }
  }
);


// Handle @app_mention with "standup" keyword
app.event('app_mention', async ({ event, client, say }) => {
  const text = event.text?.toLowerCase() || '';
  const threadTs = event.thread_ts || event.ts;

  if (text.includes('standup')) {
    try {
      const result = await client.conversations.replies({
        channel: event.channel,
        ts: threadTs,
      });

      const replies = result.messages?.filter(m => m.ts !== threadTs);
      if (!replies || replies.length === 0) {
        await say({
          thread_ts: threadTs,
          text: `No standup updates found in this thread.`,
        });
        return;
      }

      const summary = replies
        .map(m => `• *<@${m.user}>*: ${m.text}`)
        .join('\n');

      await say({
        thread_ts: threadTs,
        text: `📋 *Standup Summary:*\n${summary}`,
      });
    } catch (error) {
      console.error('Error fetching thread replies:', error);
      await say({
        thread_ts: threadTs,
        text: `❌ Couldn't fetch the standup summary. Please try again later.`,
      });
    }
  } else {
    await say({
      thread_ts: event.ts,
      text: `Hi <@${event.user}>, mention me with \`standup\` in a standup thread to get the summary!`,
    });
  }
});

// Web UI to view updates
expressApp.get('/standup', async (req, res) => {
  let html = `<h1>Daily Standup Updates</h1>`;

  if (Object.keys(standups).length === 0) {
    html += `<p>No standup data available.</p>`;
  } else {
    const threadsSorted = Object.entries(standups).sort(
      ([aTs], [bTs]) => parseFloat(bTs) - parseFloat(aTs)
    );

    for (const [threadTs, { date, updatesByUser }] of threadsSorted) {
      html += `<h2>📅 ${date}</h2>`;

      for (const userId in updatesByUser) {
        let userDisplay = userId;
        try {
          const userInfo = await app.client.users.info({ user: userId });
          userDisplay = userInfo.user?.real_name || userInfo.user?.name || userId;
        } catch (err) {
          console.error(`❌ Couldn't fetch user info for ${userId}:`, err);
        }

        html += `<h3>${userDisplay}</h3><ul>`;
        updatesByUser[userId].forEach(update => {
          html += `<li>${update.text}</li>`;
        });
        html += `</ul>`;
      }
    }
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Standup Summary</title>
      <style>
        body { font-family: sans-serif; margin: 2rem; line-height: 1.6; background: #f5f5f5; }
        h1 { color: #222; }
        h2 { color: #333; margin-top: 2rem; }
        h3 { color: #555; margin-top: 1rem; }
        ul { padding-left: 1.5rem; }
        li { background: #fff; padding: 0.5rem; margin-bottom: 0.3rem; border-radius: 5px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
      </style>
    </head>
    <body>
      ${html}
    </body>
    </html>
  `);
});



expressApp.get('/standup-history', async (req, res) => {
  const dateEntries = Object.entries(standupThreadsByDate).sort(
    (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
  );

  let html = `<h1>📆 Standup History</h1>`;

  for (const [date, threadTs] of dateEntries) {
    try {
      const result = await app.client.conversations.replies({
        channel: channelId,
        ts: threadTs,
      });

      const replies = result.messages?.filter(m => m.ts !== threadTs);
      html += `<h2>${date}</h2>`;

      if (!replies || replies.length === 0) {
        html += `<p><i>No updates.</i></p>`;
        continue;
      }

      const grouped = replies.reduce<Record<string, string[]>>((acc, m) => {
        if (!m.user || !m.text) return acc;
        acc[m.user] = acc[m.user] || [];
        acc[m.user].push(m.text);
        return acc;
      }, {});

      for (const [user, messages] of Object.entries(grouped)) {
        html += `<h3><a href="https://slack.com/team/${user}" target="_blank">@${user}</a></h3><ul>`;
        for (const msg of messages) {
          html += `<li>${msg}</li>`;
        }
        html += `</ul>`;
      }
    } catch (error) {
      html += `<p style="color:red">❌ Failed to load thread for ${date}</p>`;
      console.error(`Error loading thread for ${date}:`, error);
    }
  }

  res.send(html);
});


expressApp.get('/health', (_, res) => res.send('OK'));

const PORT = Number(process.env.PORT) || 3000;

(async () => {
  await app.start();
  console.log('⚡️ Slack bot started in Socket Mode');

  expressApp.listen(PORT, () => {
    console.log(`🌐 Express UI running on port ${PORT}`);
  });
})();
