import { CronJob } from 'cron';
import {slackApp} from '../singleton'
import { CHANNEL_ID } from '../config';

export const standupHuddleFollowUp= new CronJob(
  '0 10 * * *',
  async () => {
    try {
      await slackApp.client.chat.postMessage({
        channel: CHANNEL_ID,
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