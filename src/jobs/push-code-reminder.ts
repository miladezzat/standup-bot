import { CronJob } from 'cron';
import { slackApp } from '../singleton';
import { CHANNEL_ID, APP_TIMEZONE } from '../config';
import { logInfo, logError } from '../utils/logger';

// First reminder to push code - runs at 5:00 PM Cairo time Sun-Thu
export const pushCodeReminderFirst = new CronJob(
  process.env.PUSH_CODE_REMINDER_FIRST_CRON || '0 17 * * 0-4', // Default: 5:00 PM Sun-Thu
  async () => {
    try {
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

      logInfo('✅ Push code reminder (first) sent successfully');
    } catch (error) {
      logError('❌ Error sending push code reminder (first):', error);
    }
  },
  null, // onComplete
  false, // start
  APP_TIMEZONE // timezone
);

// Second reminder to push code - runs at 6:10 PM Cairo time Sun-Thu
export const pushCodeReminderSecond = new CronJob(
  process.env.PUSH_CODE_REMINDER_SECOND_CRON || '10 18 * * 0-4', // Default: 6:10 PM Sun-Thu
  async () => {
    try {
      logInfo('📤 Sending push code reminder (final) to the team...');
      
      await slackApp.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: '🚨 Final Reminder: Push your code before you leave!',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: ':warning: *Final End of Day Reminder*'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🚨 *Last call to push your code!*\n\nBefore you sign off for the day:\n\n• :white_check_mark: Commit all your changes\n• :arrow_up: Push to the remote repository\n• :memo: Update documentation if needed\n• :speech_balloon: Leave notes for tomorrow'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '_Don\'t let your hard work stay only on your local machine!_ :computer:'
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: ':alarm_clock: End of day - make sure your code is pushed and safe!'
              }
            ]
          }
        ]
      });

      logInfo('✅ Push code reminder (final) sent successfully');
    } catch (error) {
      logError('❌ Error sending push code reminder (final):', error);
    }
  },
  null, // onComplete
  false, // start
  APP_TIMEZONE // timezone
);
