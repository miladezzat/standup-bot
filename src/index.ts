import express from 'express';
import { App, ExpressReceiver, SlackEventMiddlewareArgs, AllMiddlewareArgs, GenericMessageEvent } from '@slack/bolt';
import dotenv from 'dotenv';
import { CronJob } from 'cron';
import { MESSAGE_BLOCKS } from './constants';

dotenv.config();

// Create ExpressReceiver to use custom Express app inside Bolt
const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    endpoints: '/slack/events',  // Slack events endpoint
});

const app = new App({
    token: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    socketMode: false,   // Disable socket mode because we are using ExpressReceiver
    receiver,
    appToken: process.env.SLACK_APP_TOKEN,
});

const expressApp = receiver.app; // This is the Express app used by Bolt

const channelId = process.env.CHANNEL_ID!;

// In-memory storage for standup updates
const updatesByUser: Record<string, { text: string; timestamp: string }[]> = {};

// Your cron job for sending reminders
const job = new CronJob(
    '0 9 * * *',
    async () => {
        try {
            await app.client.chat.postMessage({
                channel: channelId,
                text:
                    'Good morning, team! :sunny: \n\nIt\'s time for our daily standup. Please reply in this thread with your updates:\n• What did you accomplish yesterday?\n• What are your plans for today?\n• Any blockers or challenges?',
                blocks: MESSAGE_BLOCKS
            });
            console.log('✅ Sent standup reminder');
        } catch (err) {
            console.error('❌ Error sending message:', err);
        }
    },
    null,
    true,
    'Africa/Cairo'
);

app.message(async (args: SlackEventMiddlewareArgs<'message'> & AllMiddlewareArgs) => {
    const { message, say } = args;
    if ('channel' in message && 'user' in message && !('subtype' in message)) {
        const msg = message as GenericMessageEvent;
        if (msg.channel === channelId) {
            if (!updatesByUser[msg.user]) updatesByUser[msg.user] = [];
            updatesByUser[msg.user].push({
                text: msg.text || '',
                timestamp: msg.ts,
            });
            await say(`Thanks for the update, <@${msg.user}>!`);
        }
    }
});

app.command('/standup', async ({ command, ack, respond }) => {
    await ack();

    await app.client.chat.postMessage({
        channel: channelId,
        text:
            'Good morning, team! :sunny: \n\nIt\'s time for our daily standup. Please reply in this thread with your updates:\n• What did you accomplish yesterday?\n• What are your plans for today?\n• Any blockers or challenges?',
        blocks: MESSAGE_BLOCKS,
    });

    await respond({
        text: `Standup triggered manually by <@${command.user_id}>.`,
        response_type: 'ephemeral',
    });
});

// Handle /summary command
app.command('/summary', async ({ command, ack, respond }) => {
    await ack();

    const updates = updatesByUser[command.user_id];
    if (!updates || updates.length === 0) {
        await respond({
            text: "You haven't submitted any updates today.",
            response_type: 'ephemeral',
        });
        return;
    }

    const summary = updates
        .map(u => `• ${new Date(parseFloat(u.timestamp) * 1000).toLocaleTimeString()}: ${u.text}`)
        .join('\n');

    await respond({
        text: `Here's your standup summary for today:\n${summary}`,
        response_type: 'ephemeral',
    });
});

// Handle /help command
app.command('/help', async ({ ack, respond }) => {
    await ack();

    await respond({
        text: `👋 Here’s what I can do:\n
• \`/standup\` – Trigger the standup reminder manually.
• \`/summary\` – Get a DM with your submitted standup updates.
• \`/help\` – Show this help message.
    
_Thanks for staying aligned! 🚀_`,
        response_type: 'ephemeral',
    });
});


// Add a simple UI route on the same Express app
expressApp.get('/standup', (req, res) => {
    let html = `<h1>Daily Standup Updates</h1>`;
    if (Object.keys(updatesByUser).length === 0) {
        html += `<p>No updates yet.</p>`;
    } else {
        for (const userId in updatesByUser) {
            html += `<h2>User: <a href="https://slack.com/team/${userId}" target="_blank">${userId}</a></h2><ul>`;
            updatesByUser[userId].forEach(update => {
                html += `<li>${new Date(parseFloat(update.timestamp) * 1000).toLocaleTimeString()} — ${update.text}</li>`;
            });
            html += `</ul>`;
        }
    }
    res.send(html);
});

expressApp.get('/health', (_, res) => res.send('OK'));


// Start the combined app on the Heroku port
(async () => {
    const port = Number(process.env.PORT) || 3000;
    await app.start(port);
    console.log(`⚡️ Slack bot and UI running on port ${port}`);
})();
