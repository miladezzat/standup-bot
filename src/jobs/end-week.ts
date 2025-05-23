import { CronJob } from 'cron';
import { slackApp } from '../singleton';
import { CHANNEL_ID } from '../config';

export const endWeek = new CronJob(
  '0 17 * * 4', // Every Thursday at 17:00 (5:00 PM) Cairo time
  async () => {
    try {
      console.log('Register Weekly Thursday End-of-Week Reminder');
      await slackApp.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: `@channel :tada: Great work this week, team! Let's wrap things up strong and prepare for a restful weekend. Appreciate all your efforts!`,
        link_names: true,
      });
      console.log('✅ Sent weekly Thursday end-of-week reminder');
    } catch (err) {
      console.error('❌ Error sending weekly Thursday end-of-week reminder:', err);
    }
  },
  null,
  true,
  'Africa/Cairo'
);
