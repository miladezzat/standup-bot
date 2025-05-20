import { App, SlackEventMiddlewareArgs, AllMiddlewareArgs, GenericMessageEvent } from '@slack/bolt';
import dotenv from 'dotenv';
import { CronJob } from 'cron';  // <-- changed here

dotenv.config();

const app = new App({
    token: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN!,
});

const channelId = process.env.CHANNEL_ID!;

// Scheduled reminder: 9 AM Cairo time using cron package with timezone support
const job = new CronJob(
  '0 9 * * *', // 9:00 AM every day
  async () => {
    try {
      await app.client.chat.postMessage({
        channel: channelId,
        text: 'Good morning, team! :sunny: \n\nIt\'s time for our daily standup. Please reply in this thread with your updates:\n• What did you accomplish yesterday?\n• What are your plans for today?\n• Any blockers or challenges?',
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":wave: *Good morning, team!*\n\nIt's time for our daily standup."
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Please reply in this thread* with your updates:"
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "• *What did you accomplish yesterday?*\n• *What are your plans for today?*\n• *Any blockers or challenges?*"
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "Thank you for keeping us all aligned! :rocket:"
              }
            ]
          }
        ]
      });
      console.log('✅ Sent standup reminder');
    } catch (err) {
      console.error('❌ Error sending message:', err);
    }
  },
  null,
  true,             // Start the job right now
  'Africa/Cairo'    // Timezone
);

app.message(async (args: SlackEventMiddlewareArgs<'message'> & AllMiddlewareArgs) => {
    const { message, say } = args;

    // Narrow the type properly
    if ('channel' in message && 'user' in message && !('subtype' in message)) {
        const msg = message as GenericMessageEvent;
        if (msg.channel === channelId) {
            await say(`Thanks for the update, <@${msg.user}>!`);
        }
    }
});

(async () => {
    await app.start(Number(process.env.PORT) || 3000);
    console.log('⚡️ Slack bot is running (TS)');
})();
