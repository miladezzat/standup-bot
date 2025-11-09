import { CronJob } from 'cron';
import { slackApp } from '../singleton';
import { getTeamMembersWhoHaventSubmitted } from '../service/team-members.service';

// Reminder for non-submitters - runs at 10:30 AM Cairo time Mon-Fri
export const reminderNonSubmitters = new CronJob(
  process.env.NON_SUBMITTER_REMINDER_CRON || '30 10 * * 1-5', // Default: 10:30 AM Mon-Fri
  async () => {
    try {
      console.log('🔔 Checking for team members who haven\'t submitted...');
      
      const notSubmitted = await getTeamMembersWhoHaventSubmitted();
      
      if (notSubmitted.length === 0) {
        console.log('✅ All team members have submitted their standups!');
        return;
      }

      console.log(`📤 Sending reminders to ${notSubmitted.length} team member(s)...`);

      // Send DM to each user who hasn't submitted
      for (const member of notSubmitted) {
        try {
          await slackApp.client.chat.postMessage({
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
          });
          
          console.log(`✅ Sent reminder to ${member.realName} (${member.id})`);
        } catch (error) {
          console.error(`❌ Error sending reminder to ${member.id}:`, error);
        }
      }

      console.log('✅ Finished sending reminders');
    } catch (err) {
      console.error('❌ Error in reminderNonSubmitters job:', err);
    }
  },
  null,
  true,
  'Africa/Cairo'
);

