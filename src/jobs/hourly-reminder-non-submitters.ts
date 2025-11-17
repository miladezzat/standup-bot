import { CronJob } from 'cron';
import { slackApp } from '../singleton';
import { getTeamMembersWhoHaventSubmitted } from '../service/team-members.service';
import { APP_TIMEZONE } from '../config';

// Hourly reminder for non-submitters - runs every hour from 11 AM to 5 PM
export const hourlyReminderNonSubmitters = new CronJob(
  process.env.HOURLY_REMINDER_CRON || '0 11-17 * * 0-4', // Default: Every hour from 11 AM to 5 PM Sun-Thu
  async () => {
    try {
      console.log('🔔 Hourly check for team members who haven\'t submitted...');
      
      const notSubmitted = await getTeamMembersWhoHaventSubmitted();
      
      if (notSubmitted.length === 0) {
        console.log('✅ All team members have submitted their standups!');
        return;
      }

      console.log(`📤 Sending hourly reminders to ${notSubmitted.length} team member(s)...`);

      // Send DM to each user who hasn't submitted
      for (const member of notSubmitted) {
        try {
          await slackApp.client.chat.postMessage({
            channel: member.id,
            text: '⏰ Reminder: You still haven\'t submitted your standup today!',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `⏰ Hi ${member.realName}! You still haven't submitted your standup today.`
                }
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: 'Please take a moment to share your updates with the team. It helps everyone stay aligned!'
                }
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: {
                      type: 'plain_text',
                      text: '📝 Submit Now'
                    },
                    action_id: 'open_standup_modal',
                    style: 'primary'
                  }
                ]
              },
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: 'Type `/standup` to submit your notes'
                  }
                ]
              }
            ]
          });
          
          console.log(`✅ Sent hourly reminder to ${member.realName} (${member.id})`);
        } catch (error) {
          console.error(`❌ Error sending hourly reminder to ${member.id}:`, error);
        }
      }

      console.log('✅ Finished sending hourly reminders');
    } catch (err) {
      console.error('❌ Error in hourlyReminderNonSubmitters job:', err);
    }
  },
  null,
  false,
  APP_TIMEZONE
);
