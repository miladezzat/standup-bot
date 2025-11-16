import StandupEntry from '../models/standupEntry';
import { format, parseISO, isValid, addDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { estimateStandupTime } from './ai-time-estimation.service';
import { generateStandupSummary } from './ai-summary.service';
import { CHANNEL_ID } from '../config';
import { slackWebClient } from '../singleton';

const TIMEZONE = 'Africa/Cairo';
const DAY_OFF_STATUS_EMOJI = ':palm_tree:';

const DEFAULT_DAY_OFF_MESSAGE = 'Taking time off';

interface DayOffCommandParseResult {
  targetDate: string;
  reason: string;
  isToday: boolean;
  timeRange?: { start: string; end: string };
}

export const handleStandupSlashCommand = async ({ ack, body, client, respond }: any) => {
  await ack();

  const text = (body.text || '').trim();
  if (text.toLowerCase().startsWith('ooo')) {
    await handleQuickDayOffCommand({ body, client, respond, text });
    return;
  }

  await openStandupModal({ client, body });
};

export const openStandupModal = async ({ client, body }: any) => {
  try {
    const today = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');
    
    // Check if user already submitted today
    const existingEntry = await StandupEntry.findOne({
      slackUserId: body.user_id,
      date: today
    });

    const dayOffOption = {
      text: {
        type: 'plain_text',
        text: 'I am OOO / taking the day off'
      },
      value: 'day_off'
    };

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
          },
          {
            type: 'input',
            block_id: 'dayoff_toggle_block',
            element: {
              type: 'checkboxes',
              action_id: 'dayoff_toggle',
              options: [dayOffOption],
              initial_options: existingEntry?.isDayOff ? [{ ...dayOffOption }] : undefined
            },
            label: {
              type: 'plain_text',
              text: 'Are you out of office today?'
            },
            optional: true
          },
          {
            type: 'input',
            block_id: 'dayoff_reason_block',
            element: {
              type: 'plain_text_input',
              action_id: 'dayoff_reason_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'Optional note about your day off or coverage...'
              },
              initial_value: existingEntry?.dayOffReason || ''
            },
            label: {
              type: 'plain_text',
              text: 'Day off reason (optional)'
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

const normalizeReasonForSlack = (reason: string) => reason.replace(/[<>]/g, '').trim();

const parseTimeStringToMinutes = (input: string): number | null => {
  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3];
  if (hours > 23 || minutes > 59) return null;
  if (meridiem) {
    if (hours === 12) {
      hours = meridiem === 'am' ? 0 : 12;
    } else if (meridiem === 'pm') {
      hours += 12;
    }
  }
  return hours * 60 + minutes;
};

const formatMinutesToTimeString = (minutes: number): string => {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

const extractTimeRange = (text: string): { cleanedText: string; range?: { start: string; end: string } } => {
  const regex = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
  const match = text.match(regex);
  if (!match) {
    return { cleanedText: text };
  }
  const startMinutes = parseTimeStringToMinutes(match[1]);
  const endMinutes = parseTimeStringToMinutes(match[2]);
  if (
    startMinutes === null ||
    endMinutes === null ||
    endMinutes <= startMinutes
  ) {
    return { cleanedText: text };
  }
  const range = {
    start: formatMinutesToTimeString(startMinutes),
    end: formatMinutesToTimeString(endMinutes)
  };
  const cleanedText = (text.slice(0, match.index) + text.slice((match.index || 0) + match[0].length)).trim();
  return { cleanedText, range };
};

const parseDayOffCommand = (text: string): DayOffCommandParseResult => {
  const remainder = text.replace(/^ooo\s*/i, '').trim();
  const now = toZonedTime(new Date(), TIMEZONE);
  const today = format(now, 'yyyy-MM-dd');
  let targetDate = today;
  let reason = remainder;
  let timeRange: { start: string; end: string } | undefined;

  if (remainder) {
    const { cleanedText, range } = extractTimeRange(remainder);
    if (range) {
      timeRange = range;
      reason = cleanedText;
    }
  }

  if (remainder) {
    const firstToken = remainder.split(/\s+/)[0];
    const normalized = firstToken.toLowerCase();
    let parsedDate: Date | null = null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(firstToken)) {
      const iso = parseISO(firstToken);
      parsedDate = isValid(iso) ? iso : null;
    } else if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}$/i.test(firstToken)) {
      const iso = parseISO(firstToken);
      parsedDate = isValid(iso) ? iso : null;
    } else if (normalized === 'today') {
      parsedDate = now;
    } else if (normalized === 'tomorrow') {
      parsedDate = addDays(now, 1);
    }

    if (parsedDate) {
      targetDate = format(parsedDate, 'yyyy-MM-dd');
      reason = remainder.slice(firstToken.length).trim();
    }
  }

  const finalReason = reason || DEFAULT_DAY_OFF_MESSAGE;
  return {
    targetDate,
    reason: finalReason,
    isToday: targetDate === today,
    timeRange
  };
};

const handleQuickDayOffCommand = async ({ body, client, respond, text }: any) => {
  try {
    const userId = body.user_id;
    const userName = body.user_name || 'Unknown';
    const workspaceId = body.team_id || '';
    const { targetDate, reason, isToday, timeRange } = parseDayOffCommand(text);
    const baseReason = normalizeReasonForSlack(reason);
    const timeText = timeRange ? ` (${timeRange.start}-${timeRange.end})` : '';
    const reasonForSlack = `${baseReason}${timeText}`.trim();

    await StandupEntry.findOneAndUpdate(
      {
        slackUserId: userId,
        date: targetDate
      },
      {
        slackUserId: userId,
        slackUserName: userName,
        date: targetDate,
        yesterday: 'Day off',
        today: 'Day off',
        blockers: '',
        notes: `OOO: ${reasonForSlack}`,
        isDayOff: true,
        dayOffReason: reasonForSlack,
        dayOffStartTime: timeRange?.start || '00:00',
        dayOffEndTime: timeRange?.end || '23:59',
        source: 'slash_command',
        workspaceId,
        yesterdayHoursEstimate: 0,
        todayHoursEstimate: 0,
        timeEstimatesRaw: null,
        aiSummary: ''
      },
      {
        upsert: true,
        new: true
      }
    );

    await applyDayOffStatus(userId, targetDate, baseReason, timeRange);

    const targetDateObj = toZonedTime(parseISO(targetDate), TIMEZONE);
    const displayDate = format(targetDateObj, 'EEEE, MMM d');

    if (respond) {
      await respond({
        response_type: 'ephemeral',
        text: `🛫 You're marked as out of office ${isToday ? 'today' : `on ${displayDate}`}${reasonForSlack ? ` – ${reasonForSlack}` : ''}.`
      });
    }

    const channelText = isToday
      ? `🛫 Heads up: <@${userId}> is out of office today${reasonForSlack ? ` – ${reasonForSlack}` : ''}.`
      : `🛫 Heads up: <@${userId}> will be out on ${displayDate}${reasonForSlack ? ` – ${reasonForSlack}` : ''}.`;
    const blockText = isToday
      ? `🛫 *Out of Office Alert*
<@${userId}> is out today${reasonForSlack ? `:
> ${reasonForSlack}` : '.'}`
      : `🛫 *Scheduled Day Off*
<@${userId}> will be out on *${displayDate}*${reasonForSlack ? `:
> ${reasonForSlack}` : '.'}`;

    await client.chat.postMessage({
      channel: CHANNEL_ID,
      text: channelText,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: blockText
          }
        }
      ]
    });

    console.log(`🛫 Recorded day off for ${userName} on ${targetDate}`);
  } catch (error) {
    console.error('Error handling quick day off command:', error);
    if (respond) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Sorry, something went wrong saving your day off. Please try again or use `/standup`.'
      });
    }
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
    const yesterdayRaw = values.yesterday_block.yesterday_input.value || '';
    const todayRaw = values.today_block.today_input.value || '';
    const blockers = values.blockers_block?.blockers_input?.value || '';
    const notes = values.notes_block?.notes_input?.value || '';
    const isDayOff = Boolean(values.dayoff_toggle_block?.dayoff_toggle?.selected_options?.length);
    const rawDayOffReason = values.dayoff_reason_block?.dayoff_reason_input?.value || '';
    const dayOffReason = isDayOff ? rawDayOffReason : '';
    const dayOffStartTime = isDayOff ? '00:00' : '';
    const dayOffEndTime = isDayOff ? '23:59' : '';
    const yesterday = isDayOff && !yesterdayRaw.trim() ? 'Day off' : yesterdayRaw;
    const today_plan = isDayOff && !todayRaw.trim() ? 'Day off' : todayRaw;

    // Validate required fields
    if (!isDayOff && (!yesterday.trim() || !today_plan.trim())) {
      // This shouldn't happen as fields are required, but just in case
      console.error('Missing required fields');
      return;
    }

    // Estimate time using AI (if configured)
    let timeEstimates = null;
    let yesterdayHours = 0;
    let todayHours = 0;
    let aiSummary = '';

    if (!isDayOff && process.env.OPENAI_API_KEY) {
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
        isDayOff: isDayOff,
        dayOffReason: dayOffReason,
        dayOffStartTime,
        dayOffEndTime,
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

    if (isDayOff) {
      await applyDayOffStatus(userId, today, dayOffReason);
    } else {
      await clearSlackStatus(userId);
    }

    // Build confirmation message
    let confirmationText = `✅ *Your standup for ${today} has been saved!*\n\nThank you for keeping the team updated. You can update it anytime by running \`/standup\` again.`;
    
    // Add status info
    if (isDayOff) {
      confirmationText += `\n\n🛫 *Status:* Marked as out of office${dayOffReason ? ` (${dayOffReason})` : ''}.`;
    }

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

    // Notify channel
    try {
    const channelText = isDayOff
        ? `🛫 Heads up: <@${userId}> is out of office today${dayOffReason ? ` – ${dayOffReason}` : ''}.`
        : `Thanks <@${userId}> for your standup notes! 🙏`;
      const blockText = isDayOff
        ? `🛫 *Out of Office Alert*\n<@${userId}> is out today${dayOffReason ? `:\n> ${dayOffReason}` : '.'}`
        : `Thanks <@${userId}> for your standup notes! 🙏`;

      await client.chat.postMessage({
        channel: CHANNEL_ID,
        text: channelText,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: blockText
            }
          }
        ]
      });
      console.log(
        isDayOff
          ? `📢 Posted OOO announcement to channel for ${userName}`
          : `📢 Posted thank you message to channel for ${userName}`
      );
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
const setSlackStatus = async (userId: string, statusText: string, statusEmoji: string, expiration: number) => {
  if (!process.env.SLACK_BOT_TOKEN) return;
  try {
    await slackWebClient.users.profile.set({
      user: userId,
      profile: JSON.stringify({
        status_text: statusText,
        status_emoji: statusEmoji,
        status_expiration: expiration
      })
    });
  } catch (error) {
    console.error('Error setting Slack status:', error);
  }
};

const clearSlackStatus = async (userId: string) => {
  if (!process.env.SLACK_BOT_TOKEN) return;
  try {
    await slackWebClient.users.profile.set({
      user: userId,
      profile: JSON.stringify({
        status_text: '',
        status_emoji: '',
        status_expiration: 0
      })
    });
  } catch (error) {
    console.error('Error clearing Slack status:', error);
  }
};

const computeDayOffExpiration = (dateStr: string, endTime?: string) => {
  let isoString = `${dateStr}T23:59:59`;
  if (endTime) {
    isoString = `${dateStr}T${endTime}:00`;
  }
  const end = toZonedTime(new Date(isoString), TIMEZONE);
  return Math.floor(end.getTime() / 1000);
};

const applyDayOffStatus = async (
  userId: string,
  targetDate: string,
  reason: string,
  timeRange?: { start: string; end: string }
) => {
  const expiration = computeDayOffExpiration(targetDate, timeRange?.end);
  const timeSuffix = timeRange ? ` (${timeRange.start}-${timeRange.end})` : '';
  const text = reason ? `OOO – ${reason}${timeSuffix}` : `Out of office${timeSuffix}`;
  await setSlackStatus(userId, text.trim(), DAY_OFF_STATUS_EMOJI, expiration);
};
