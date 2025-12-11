import { CronJob } from 'cron';
import { slackApp } from '../singleton';
import { CHANNEL_ID, APP_TIMEZONE } from '../config';
import { logInfo, logError } from '../utils/logger';
import { isWorkingDay } from '../utils/egyptian-holidays';

// Reminder to push code before end of day - runs at 5:00 PM Cairo time Sun-Thu
export const pushCodeReminder = new CronJob(
  process.env.PUSH_CODE_REMINDER_CRON || '0 17 * * 0-4', // Default: 5:00 PM Sun-Thu
  async () => {
    try {
      // Check if today is a working day (skip weekends and Egyptian holidays)
      const isWorking = await isWorkingDay();
      if (!isWorking) {
        logInfo('⏭️  Skipping push code reminder - today is a weekend or holiday');
        return;
      }
      
      logInfo('📤 Sending push code reminder to the team...');
      
      await slackApp.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: '🚀 Reminder: Don\'t forget to push your code before you close for the day!',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: ':git: *End of Day Reminder*'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🚀 *Don\'t forget to push your code!*\n\nBefore you close for the day, please make sure to:\n\n• Commit your work with clear, descriptive messages\n• Push your code to the remote repository\n• Update any related pull requests\n• Document any work in progress'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '_This helps keep the team in sync and ensures your work is safely backed up!_'
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: ':rocket: Remember: Commit early, commit often, push before you leave!'
              }
            ]
          }
        ]
      });

      logInfo('✅ Push code reminder sent successfully');
    } catch (error) {
      logError('❌ Error sending push code reminder:', error);
    }
  },
  null, // onComplete
  false, // start
  APP_TIMEZONE // timezone
);
