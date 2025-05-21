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
import { WebClient, ConversationsRepliesResponse } from '@slack/web-api';
import { connectToDatabase } from './db/connection';
import StandupThread from './models/standupThread';
import { formatStandupHTML, getUserName } from './helper';

dotenv.config();

interface SlackMessage {
    ts: string;
    user?: string;
    text?: string;
    [key: string]: any;
}

const app = new App({
    token: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN!,
});

const token = process.env.SLACK_BOT_TOKEN; // Ensure this has the necessary scopes
const web = new WebClient(token);

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
            
            // Save the thread to MongoDB
            if (currentStandupThreadTs) {
                const dateKey = format(new Date(), 'yyyy-MM-dd');
                await StandupThread.findOneAndUpdate(
                    { date: dateKey },
                    { 
                        date: dateKey,
                        threadTs: currentStandupThreadTs,
                        channelId: channelId 
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
    const standupThreads = await StandupThread.find().sort({ date: -1 });


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

            const grouped: Record<string, string[]> = replies.filter((m)=> {
                return m.user !== 'U08T0FLAJ11';
            }).reduce((acc, m) => {
                if (!m.user || !m.text) return acc;
                acc[m.user] = acc[m.user] || [];
                acc[m.user].push(m.text);
                return acc;
            }, {} as Record<string, string[]>);

            for (const [user, messages] of Object.entries(grouped)) {
                const displayName = await getUserName(user);
                html += `<div class="user-block"><h3><a href="https://slack.com/team/${user}" target="_blank" rel="noopener noreferrer">@${displayName}</a></h3>`;
                for (const msg of messages) {
                    if (!msg || !formatStandupHTML(msg).length) continue;
                    html += formatStandupHTML(msg);
                }
                html += `</div>`;
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
