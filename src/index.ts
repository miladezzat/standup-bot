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
const updatesByUser: Record<string, { text: string; timestamp: string }[]> = {};
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

    // ✅ Force the correct type here
    const msg = message as GenericMessageEvent;

    if (
      msg.channel === channelId &&
      msg.user &&
      msg.thread_ts &&
      msg.thread_ts !== msg.ts &&
      msg.thread_ts === currentStandupThreadTs
    ) {
      if (!updatesByUser[msg.user]) updatesByUser[msg.user] = [];
      updatesByUser[msg.user].push({
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
expressApp.get('/standup', (req, res) => {
  let html = `<h1>Daily Standup Updates</h1>`;
  if (Object.keys(updatesByUser).length === 0) {
    html += `<p>No updates yet.</p>`;
  } else {
    for (const userId in updatesByUser) {
      html += `<h2>User: <a href="https://slack.com/team/${userId}" target="_blank">${userId}</a></h2><ul>`;
      updatesByUser[userId].forEach(update => {
        html += `<li>${new Date(
          parseFloat(update.timestamp) * 1000
        ).toLocaleTimeString()} — ${update.text}</li>`;
      });
      html += `</ul>`;
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
