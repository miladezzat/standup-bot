import { CronJob } from 'cron';
import { slackApp } from '../singleton';
import { CHANNEL_ID, APP_TIMEZONE } from '../config';
import { logInfo, logError } from '../utils/logger';

export const standupHuddleFollowUp = new CronJob(
  process.env.STANDUP_HUDDLE_CRON || '0 10 * * 0-4', // Default: 10:00 AM Sun-Thu
  async () => {
    try {
      await slackApp.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: `@channel :sunny: It's time for our daily standup huddle — starting in 15 minutes! Please make sure to join the thread and share your updates if you haven't already.`,
        link_names: true,
      });
      logInfo('✅ Sent standup huddle reminder');
    } catch (err) {
      logError('❌ Error sending standup huddle reminder:', err);
    }
  },
  null,
  false,
  APP_TIMEZONE
);
