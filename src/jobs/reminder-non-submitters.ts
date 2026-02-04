import { CronJob } from 'cron';
import { slackApp } from '../singleton';
import { getTeamMembersWhoHaventSubmitted } from '../service/team-members.service';
import { APP_TIMEZONE } from '../config';
import { logInfo, logError } from '../utils/logger';
import { retryAsync } from '../utils/retry';

// Reminder for non-submitters - runs at 10:05 AM Cairo time Sun-Thu (10 mins before standup)
export const reminderNonSubmitters = new CronJob(
  process.env.NON_SUBMITTER_REMINDER_CRON || '5 10 * * 0-4', // Default: 10:05 AM Sun-Thu
  async () => {
    try {
      logInfo('🔔 Checking for team members who haven\'t submitted...');
      
      const notSubmitted = await getTeamMembersWhoHaventSubmitted();
      
      if (notSubmitted.length === 0) {
        logInfo('✅ All team members have submitted their standups!');
        return;
      }

      logInfo(`📤 Sending reminders to ${notSubmitted.length} team member(s)...`);

      // Send DM to each user who hasn't submitted
      for (const member of notSubmitted) {
        try {
          await retryAsync(
            () => slackApp.client.chat.postMessage({
            channel: member.id,
            text: '👋 Friendly reminder: You haven\'t submitted your standup yet today!',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `👋 Hi ${member.realName}! You haven't submitted your standup yet today.`
                }
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: 'Please take a moment to share your updates with the team by typing `/standup` here or in any channel.'
                }
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: {
                      type: 'plain_text',
                      text: '📝 Submit Standup'
                    },
                    action_id: 'open_standup_modal',
                    style: 'primary'
                  }
                ]
              }
            ]
            }),
            { maxAttempts: 3, delayMs: 60000 }
          );
          
          logInfo(`✅ Sent reminder to ${member.realName} (${member.id})`);
        } catch (error) {
          logError(`❌ Error sending reminder to ${member.id}:`, error);
        }
      }

      logInfo('✅ Finished sending reminders');
    } catch (err) {
      logError('❌ Error in reminderNonSubmitters job:', err);
    }
  },
  null,
  false,
  APP_TIMEZONE
);
