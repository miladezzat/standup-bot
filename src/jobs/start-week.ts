import { CronJob } from 'cron';
import { slackApp } from '../singleton';
import { CHANNEL_ID, APP_TIMEZONE } from '../config';

export const startWeek = new CronJob(
  '30 10 * * 0', // Every Sunday at 10:30 AM 
  async () => {
    try {
        console.log('Register Weekly Sunday Standup')
      await slackApp.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: `@channel :sunny: Good morning team! Wishing you all a productive and positive week ahead. Let’s kick things off strong!`,
        link_names: true,
      });
      console.log('✅ Sent weekly Sunday standup reminder');
    } catch (err) {
      console.error('❌ Error sending weekly Sunday standup reminder:', err);
    }
  },
  null,
  false,
  APP_TIMEZONE
);
