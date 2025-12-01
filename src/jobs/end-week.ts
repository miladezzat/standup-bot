import { CronJob } from 'cron';
import { slackApp } from '../singleton';
import { CHANNEL_ID, APP_TIMEZONE } from '../config';
import { logInfo, logError } from '../utils/logger';

export const endWeek = new CronJob(
  '0 17 * * 4', // Every Thursday at 17:00 (5:00 PM) Cairo time
  async () => {
    try {
      logInfo('Register Weekly Thursday End-of-Week Reminder');
      await slackApp.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: `@channel :tada: Great work this week, team! Let's wrap things up strong and prepare for a restful weekend. Appreciate all your efforts!`,
        link_names: true,
      });
      logInfo('✅ Sent weekly Thursday end-of-week reminder');
    } catch (err) {
      logError('❌ Error sending weekly Thursday end-of-week reminder:', err);
    }
  },
  null,
  false,
  APP_TIMEZONE
);
