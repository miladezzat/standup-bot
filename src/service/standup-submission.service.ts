import StandupEntry from '../models/standupEntry';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { estimateStandupTime } from './ai-time-estimation.service';
import { generateStandupSummary } from './ai-summary.service';
import { CHANNEL_ID } from '../config';

const TIMEZONE = 'Africa/Cairo';

export const openStandupModal = async ({ client, body }: any) => {
  try {
    const today = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');
    
    // Check if user already submitted today
    const existingEntry = await StandupEntry.findOne({
      slackUserId: body.user_id,
      date: today
    });

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'standup_submission',
        title: {
          type: 'plain_text',
          text: 'Daily Standup'
        },
        submit: {
          type: 'plain_text',
          text: existingEntry ? 'Update' : 'Submit'
        },
        close: {
          type: 'plain_text',
          text: 'Cancel'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: existingEntry 
                ? '✏️ *Update your standup for today*\nYou already submitted today. This will update your previous submission.'
                : '👋 *Share your daily standup*\nLet the team know what you\'re working on!'
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'input',
            block_id: 'yesterday_block',
            element: {
              type: 'plain_text_input',
              action_id: 'yesterday_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'List what you accomplished yesterday...'
              },
              initial_value: existingEntry?.yesterday || ''
            },
            label: {
              type: 'plain_text',
              text: '🕒 What did you do yesterday?'
            }
          },
          {
            type: 'input',
            block_id: 'today_block',
            element: {
              type: 'plain_text_input',
              action_id: 'today_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'List what you plan to work on today...'
              },
              initial_value: existingEntry?.today || ''
            },
            label: {
              type: 'plain_text',
              text: '🗓️ What will you do today?'
            }
          },
          {
            type: 'input',
            block_id: 'blockers_block',
            element: {
              type: 'plain_text_input',
              action_id: 'blockers_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'Any blockers or challenges? (optional)'
              },
              initial_value: existingEntry?.blockers || ''
            },
            label: {
              type: 'plain_text',
              text: '🚧 Any blockers?'
            },
            optional: true
          },
          {
            type: 'input',
            block_id: 'notes_block',
            element: {
              type: 'plain_text_input',
              action_id: 'notes_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'Anything else the team should know? (optional)'
              },
              initial_value: existingEntry?.notes || ''
            },
            label: {
              type: 'plain_text',
              text: '📝 Additional notes'
            },
            optional: true
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error opening standup modal:', error);
  }
};

export const handleStandupSubmission = async (args: any) => {
  const { ack, body, view, client } = args;
  await ack();

  try {
    const userId = body.user.id;
    const userName = body.user.name || 'Unknown';
    const workspaceId = body.team?.id || '';
    
    // Get today's date in Cairo timezone
    const today = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');

    // Extract form values
    const values = view.state.values;
    const yesterday = values.yesterday_block.yesterday_input.value || '';
    const today_plan = values.today_block.today_input.value || '';
    const blockers = values.blockers_block?.blockers_input?.value || '';
    const notes = values.notes_block?.notes_input?.value || '';

    // Validate required fields
    if (!yesterday.trim() || !today_plan.trim()) {
      // This shouldn't happen as fields are required, but just in case
      console.error('Missing required fields');
      return;
    }

    // Estimate time using AI (if configured)
    let timeEstimates = null;
    let yesterdayHours = 0;
    let todayHours = 0;
    let aiSummary = '';

    if (process.env.OPENAI_API_KEY) {
      try {
        // Generate time estimates
        timeEstimates = await estimateStandupTime(yesterday, today_plan);
        yesterdayHours = timeEstimates.totalYesterdayHours;
        todayHours = timeEstimates.totalTodayHours;
        console.log(`⏱️ Estimated ${yesterdayHours}h yesterday, ${todayHours}h today for ${userName}`);

        // Generate AI summary
        aiSummary = await generateStandupSummary(userName, yesterday, today_plan, blockers, notes);
        if (aiSummary) {
          console.log(`📝 Generated summary for ${userName}`);
        }
      } catch (error) {
        console.error('Error with AI services:', error);
      }
    }

    // Upsert the standup entry (update if exists, create if not)
    const standupEntry = await StandupEntry.findOneAndUpdate(
      {
        slackUserId: userId,
        date: today
      },
      {
        slackUserId: userId,
        slackUserName: userName,
        date: today,
        yesterday: yesterday,
        today: today_plan,
        blockers: blockers,
        notes: notes,
        source: 'modal',
        workspaceId: workspaceId,
        yesterdayHoursEstimate: yesterdayHours,
        todayHoursEstimate: todayHours,
        timeEstimatesRaw: timeEstimates,
        aiSummary: aiSummary
      },
      {
        upsert: true,
        new: true
      }
    );

    console.log(`✅ Standup saved for ${userName} (${userId}) on ${today}`);

    // Build confirmation message
    let confirmationText = `✅ *Your standup for ${today} has been saved!*\n\nThank you for keeping the team updated. You can update it anytime by running \`/standup\` again.`;
    
    // Add AI summary if available
    if (aiSummary) {
      confirmationText += `\n\n📝 *AI Summary:*\n_${aiSummary}_`;
    }
    
    // Add time estimates if available
    if (yesterdayHours > 0 || todayHours > 0) {
      confirmationText += `\n\n⏱️ *Time Estimates:*`;
      if (yesterdayHours > 0) {
        confirmationText += `\n• Yesterday: ~${yesterdayHours}h`;
      }
      if (todayHours > 0) {
        confirmationText += `\n• Today: ~${todayHours}h`;
      }
    }

    // Send confirmation message to the user
    await client.chat.postMessage({
      channel: userId,
      text: `✅ Your standup for ${today} has been saved!`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: confirmationText
          }
        }
      ]
    });

    // Send thank you message to the channel
    try {
      await client.chat.postMessage({
        channel: CHANNEL_ID,
        text: `Thanks <@${userId}> for your standup notes! 🙏`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Thanks <@${userId}> for your standup notes! 🙏`
            }
          }
        ]
      });
      console.log(`📢 Posted thank you message to channel for ${userName}`);
    } catch (channelError) {
      console.error('Error posting to channel:', channelError);
      // Don't fail the whole submission if channel post fails
    }

  } catch (error) {
    console.error('Error handling standup submission:', error);
    
    // Try to send error message to user
    try {
      await args.client.chat.postMessage({
        channel: body.user.id,
        text: '❌ There was an error saving your standup. Please try again or contact your administrator.'
      });
    } catch (msgError) {
      console.error('Error sending error message:', msgError);
    }
  }
};
