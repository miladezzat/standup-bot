import express from 'express';
import dotenv from 'dotenv';
import { CronJob } from 'cron';
import { format } from 'date-fns';
import { AllMiddlewareArgs, App, SlackEventMiddlewareArgs } from '@slack/bolt';
import { ConversationsRepliesResponse, GenericMessageEvent, WebClient } from '@slack/web-api';

import { connectToDatabase } from './db/connection';
import StandupThread from './models/standupThread';
import { MESSAGE_BLOCKS } from './constants';
import { formatCairoDate, formatStandupHTML, getUserName } from './helper';

dotenv.config();



interface SlackMessage {
    ts: string;
    user?: string;
    text?: string;
    [key: string]: any;
}
// Validate essential environment variables
const requiredEnvVars = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_APP_TOKEN',
  'CHANNEL_ID',
];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const token = process.env.SLACK_BOT_TOKEN!;
const channelId = process.env.CHANNEL_ID!;

const app = new App({
  token,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN!,
});

const web = new WebClient(token);
const expressApp = express();

interface StandupUpdate {
  text: string;
  timestamp: string;
}

type UpdatesMap = Record<
  string, // thread_ts
  {
    date: string; // "yyyy-MM-dd"
    updatesByUser: Record<string, StandupUpdate[]>;
  }
>;

const standups: UpdatesMap = {};
let currentStandupThreadTs: string | null = null;

// Connect to DB before starting jobs
(async () => {
  try {
    await connectToDatabase();
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('❌ Failed to connect to MongoDB:', err);
    process.exit(1);
  }
})();

// Cron: Daily standup reminder at 09:00 Africa/Cairo
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

      if (currentStandupThreadTs) {
        const dateKey = format(new Date(), 'yyyy-MM-dd');

        await StandupThread.findOneAndUpdate(
          { date: dateKey },
          {
            date: dateKey,
            threadTs: currentStandupThreadTs,
            channelId: channelId,
          },
          { upsert: true, new: true }
        );
      }

      console.log('✅ Sent standup reminder');
    } catch (err) {
      console.error('❌ Error sending standup reminder:', err);
    }
  },
  null,
  true,
  'Africa/Cairo'
);

// Cron: Standup huddle follow-up at 10:00 Africa/Cairo
const job2 = new CronJob(
  '0 10 * * *',
  async () => {
    try {
      await app.client.chat.postMessage({
        channel: channelId,
        text: `@channel :sunny: It's time for our daily standup huddle — starting in 15 minutes! Please make sure to join the thread and share your updates if you haven't already.`,
        link_names: true,
      });
      console.log('✅ Sent standup huddle reminder');
    } catch (err) {
      console.error('❌ Error sending standup huddle reminder:', err);
    }
  },
  null,
  true,
  'Africa/Cairo'
);


// (Optional) Start express server if needed
// expressApp.listen(3000, () => console.log('Express server running on port 3000'));

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

expressApp.get('/', async (req, res) => {
    let queryDate = req.query.date as string | undefined;

    if (queryDate === 'today') {
        const now = new Date();
        queryDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    let standupThreads;
    if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
        standupThreads = await StandupThread.find({ date: queryDate }).sort({ date: -1 });
    } else {
        standupThreads = await StandupThread.find().sort({ date: -1 });
    }

    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>📆 Standup History</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet" />
      <style>
        /* Reset & base */
        * {
          box-sizing: border-box;
        }
        body {
          font-family: 'Inter', Arial, sans-serif;
          background: #f5f7fa;
          color: #2c3e50;
          margin: 0;
          padding: 0 1rem 2rem;
          line-height: 1.6;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        h1 {
          font-size: 2.5rem;
          margin: 1rem 0 2rem;
          color: #34495e;
          position: sticky;
          top: 0;
          background: #f5f7fa;
          padding: 1rem 0;
          width: 100%;
          max-width: 900px;
          border-bottom: 2px solid #2980b9;
          z-index: 100;
          text-align: center;
        }
        main {
          width: 100%;
          max-width: 900px;
        }
        section.date-block {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgb(0 0 0 / 0.1);
          padding: 1rem 1.5rem;
          margin-bottom: 2rem;
          border-left: 6px solid #2980b9;
        }
        section.date-block h2 {
          margin: 0 0 1rem;
          color: #2980b9;
          font-weight: 700;
          font-size: 1.8rem;
          border-bottom: 1px solid #dcdcdc;
          padding-bottom: 0.3rem;
        }
        div.user-block {
          margin-bottom: 1.2rem;
          padding-left: 1rem;
          border-left: 3px solid #3498db;
        }
        div.user-block h3 {
          margin: 0 0 0.5rem;
          font-size: 1.2rem;
          font-weight: 600;
        }
        div.user-block h3 a {
          color: #2980b9;
          text-decoration: none;
        }
        div.user-block h3 a:hover {
          text-decoration: underline;
        }
        ul {
          margin: 0;
          padding-left: 1.2rem;
          list-style-type: disc;
          color: #444;
        }
        li {
          margin-bottom: 0.4rem;
        }
        p.empty {
          font-style: italic;
          color: #999;
          margin-left: 1rem;
        }
        p.error {
          color: #c0392b;
          font-weight: 600;
          background: #f8d7da;
          padding: 0.5rem 1rem;
          border-radius: 5px;
          margin: 1rem 0;
        }
        @media (max-width: 600px) {
          h1 {
            font-size: 1.8rem;
            padding: 0.8rem 0;
          }
          section.date-block {
            padding: 1rem;
            border-left-width: 4px;
          }
          div.user-block {
            border-left-width: 2px;
            padding-left: 0.8rem;
          }
          div.user-block h3 {
            font-size: 1rem;
          }
          ul {
            padding-left: 1rem;
          }
        }
      </style>
    </head>
    <body>
      <h1>📆 Standup History</h1>
      <main>
    `;

    for (const thread of standupThreads) {
        html += `<section class="date-block"><h2>${thread.date}</h2>`;
        console.log(`Fetching thread for ${thread.date}...`, thread.threadTs, thread.channelId);

        try {
            const result: ConversationsRepliesResponse = await web.conversations.replies({
                channel: channelId,
                ts: thread.threadTs,
            });

            const replies: SlackMessage[] =
                result.messages?.filter(
                    (m): m is SlackMessage =>
                        m.ts !== thread.threadTs && typeof m.user === 'string' && typeof m.text === 'string'
                ) || [];

            if (replies.length === 0) {
                html += `<p class="empty">No updates.</p>`;
                html += `</section>`;
                continue;
            }

            const grouped: Record<string, { text: string; ts: string }[]> = replies
                .filter(m => m.user !== 'U08T0FLAJ11')
                .reduce((acc, m) => {
                    if (!m.user || !m.text || !m.ts) return acc;
                    acc[m.user] = acc[m.user] || [];
                    acc[m.user].push({ text: m.text, ts: m.ts });
                    return acc;
                }, {} as Record<string, { text: string; ts: string }[]>);
            for (const [user, messages] of Object.entries(grouped)) {
                const { name, avatarUrl } = await getUserName(user);

                const replyTime = messages.length
                    ? formatCairoDate(parseFloat(messages[0].ts))
                    : '';

                html += `
                    <div class="user-block" style="display: flex; align-items: flex-start; margin-bottom: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 1.5rem;">
                    <div style="text-align: center; margin-right: 1rem;">
                        <img src="${avatarUrl}" alt="${name}'s avatar" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover;">
                        <div style="font-size: 0.85rem; color: #888; margin-top: 0.3rem;">🕒 ${replyTime}</div>
                    </div>
                    <div>
                        <h3 style="margin: 0 0 0.5rem;">
                        <a href="https://slack.com/team/${user}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: #0077cc;">@${name}</a>
                        </h3>
                `;

                            for (const msgObj of messages) {
                                if (!msgObj.text || !formatStandupHTML(msgObj.text).length) continue;
                                html += formatStandupHTML(msgObj.text);
                            }

                            html += `
                    </div>
                    </div>
                `;
            }

            html += `</section>`;
        } catch (error) {
            console.error(`Error loading thread for ${thread.date}:`, error);
            html += `<p class="error">❌ Failed to load thread for ${thread.date}</p></section>`;
        }
    }

    html += `
      </main>
    </body>
    </html>
    `;
    res.send(html);
});


expressApp.get('/health', (_, res) => res.send('OK'));

const PORT = Number(process.env.PORT) || 3000;

(async () => {
    await connectToDatabase();
    await app.start();
    console.log('⚡️ Slack bot started in Socket Mode');

    expressApp.listen(PORT, () => {
        console.log(`🌐 Express UI running on port ${PORT}`);
    });
})();
