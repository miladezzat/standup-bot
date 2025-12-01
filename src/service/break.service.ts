import Break, { IBreak } from '../models/break';
import { format, addMinutes, parse } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { APP_TIMEZONE, CHANNEL_ID, MAX_BREAK_DURATION_MINUTES, BREAK_WARNING_THRESHOLD_MINUTES } from '../config';
import { slackWebClient } from '../singleton';
import { logInfo, logError, logWarn } from '../utils/logger';

const TIMEZONE = APP_TIMEZONE;

/**
 * Parse break command text
 * Examples:
 *   "break 20mins for lunch" -> { duration: 20, reason: "lunch" }
 *   "break 1hr doctor appointment" -> { duration: 60, reason: "doctor appointment" }
 *   "break 15m coffee" -> { duration: 15, reason: "coffee" }
 *   "break 30mins" -> { duration: 30, reason: "" }
 */
export interface BreakCommandParseResult {
  durationMinutes: number;
  reason: string;
  isValid: boolean;
  error?: string;
}

export function parseBreakCommand(text: string): BreakCommandParseResult {
  // Remove "break" prefix and trim
  const cleanText = text.replace(/^break\s*/i, '').trim();
  
  if (!cleanText) {
    return { durationMinutes: 0, reason: '', isValid: false, error: 'Please specify a duration (e.g., `/standup break 20mins for lunch`)' };
  }

  // Match duration patterns: 20mins, 20min, 20m, 1hr, 1hour, 1h, 90minutes
  const durationMatch = cleanText.match(/^(\d+)\s*(mins?|minutes?|m|hrs?|hours?|h)\b/i);
  
  if (!durationMatch) {
    return { durationMinutes: 0, reason: '', isValid: false, error: 'Invalid duration format. Use formats like: 20mins, 1hr, 30m' };
  }

  const value = parseInt(durationMatch[1], 10);
  const unit = durationMatch[2].toLowerCase();
  
  // Convert to minutes
  let durationMinutes = value;
  if (unit.startsWith('h')) {
    durationMinutes = value * 60;
  }

  // Validate duration
  if (durationMinutes < 1) {
    return { durationMinutes: 0, reason: '', isValid: false, error: 'Break duration must be at least 1 minute' };
  }
  if (durationMinutes > MAX_BREAK_DURATION_MINUTES) {
    return { durationMinutes: 0, reason: '', isValid: false, error: `Break duration cannot exceed ${MAX_BREAK_DURATION_MINUTES / 60} hours` };
  }

  // Extract reason (everything after duration, optionally after "for")
  const afterDuration = cleanText.slice(durationMatch[0].length).trim();
  const reason = afterDuration.replace(/^for\s+/i, '').trim();

  return { durationMinutes, reason, isValid: true };
}

/**
 * Format duration for display
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min${minutes !== 1 ? 's' : ''}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  return `${hours}h ${remainingMins}m`;
}

/**
 * Calculate end time from start time and duration
 */
export function calculateEndTime(startTime: string, durationMinutes: number): string {
  try {
    const baseDate = new Date();
    const [hours, mins] = startTime.split(':').map(Number);
    baseDate.setHours(hours, mins, 0, 0);
    const endDate = addMinutes(baseDate, durationMinutes);
    return format(endDate, 'HH:mm');
  } catch {
    return '';
  }
}

/**
 * Create a new break entry
 */
export async function createBreak(
  userId: string,
  userName: string,
  workspaceId: string,
  durationMinutes: number,
  reason: string
): Promise<IBreak> {
  const now = toZonedTime(new Date(), TIMEZONE);
  const date = format(now, 'yyyy-MM-dd');
  const startTime = format(now, 'HH:mm');
  const endTime = calculateEndTime(startTime, durationMinutes);

  const breakEntry = await Break.create({
    slackUserId: userId,
    slackUserName: userName,
    date,
    durationMinutes,
    reason,
    startTime,
    endTime,
    workspaceId,
    isActive: true
  });

  logInfo(`Break created for user ${userName}: ${durationMinutes}mins - ${reason || 'No reason'}`);
  return breakEntry;
}

/**
 * Get all breaks for a user on a specific date
 */
export async function getUserBreaksForDate(userId: string, date: string): Promise<IBreak[]> {
  return Break.find({ slackUserId: userId, date }).sort({ createdAt: -1 });
}

/**
 * Get all breaks for a workspace on a specific date
 */
export async function getWorkspaceBreaksForDate(workspaceId: string, date: string): Promise<IBreak[]> {
  return Break.find({ workspaceId, date }).sort({ createdAt: -1 });
}

/**
 * Get total break time for a user on a specific date
 */
export async function getUserTotalBreakMinutes(userId: string, date: string): Promise<number> {
  const breaks = await getUserBreaksForDate(userId, date);
  return breaks.reduce((total, b) => total + b.durationMinutes, 0);
}

/**
 * Mark a break as inactive (ended)
 */
export async function endBreak(breakId: string): Promise<IBreak | null> {
  return Break.findByIdAndUpdate(breakId, { isActive: false }, { new: true });
}

/**
 * Get active breaks for a user
 */
export async function getActiveBreaks(userId: string): Promise<IBreak[]> {
  return Break.find({ slackUserId: userId, isActive: true });
}

/**
 * Handle the break slash command
 */
export async function handleBreakCommand({ body, client, respond, text }: any): Promise<void> {
  const userId = body.user_id;
  const userName = body.user_name || 'Unknown';
  const workspaceId = body.team_id || '';

  try {
    // Parse the break command
    const parseResult = parseBreakCommand(text);

    if (!parseResult.isValid) {
      await respond({
        response_type: 'ephemeral',
        text: `❌ ${parseResult.error}\n\n*Usage:* \`/standup break <duration> [for <reason>]\`\n*Examples:*\n• \`/standup break 20mins for lunch\`\n• \`/standup break 1hr doctor appointment\`\n• \`/standup break 15m coffee\``
      });
      return;
    }

    const { durationMinutes, reason } = parseResult;

    // Check total break time for today
    const today = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');
    const totalBreakToday = await getUserTotalBreakMinutes(userId, today);
    const newTotal = totalBreakToday + durationMinutes;

    // Warn if total exceeds threshold (but still allow it)
    const warningMessage = newTotal > BREAK_WARNING_THRESHOLD_MINUTES 
      ? `\n⚠️ *Note:* Your total break time today is now ${formatDuration(newTotal)}.`
      : '';

    // Create the break
    const breakEntry = await createBreak(userId, userName, workspaceId, durationMinutes, reason);

    // Respond to user (ephemeral)
    const reasonText = reason ? ` for *${reason}*` : '';
    await respond({
      response_type: 'ephemeral',
      text: `☕ Break started! ${formatDuration(durationMinutes)}${reasonText}.\nExpected back at *${breakEntry.endTime}*.${warningMessage}`
    });

    // Post to channel
    const channelReasonText = reason ? ` – ${reason}` : '';
    await client.chat.postMessage({
      channel: CHANNEL_ID,
      text: `☕ <@${userId}> is taking a ${formatDuration(durationMinutes)} break${channelReasonText}. Back around ${breakEntry.endTime}.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `☕ *Break Time*\n<@${userId}> is taking a *${formatDuration(durationMinutes)}* break${channelReasonText}.\n_Expected back at ${breakEntry.endTime}_`
          }
        }
      ]
    });

    logInfo(`Break command processed: ${userName} - ${durationMinutes}mins - ${reason}`);

  } catch (error) {
    logError('Error handling break command', error);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Sorry, something went wrong while logging your break. Please try again.'
    });
  }
}

/**
 * Get break statistics for a user over a period
 */
export async function getUserBreakStats(userId: string, startDate: string, endDate: string) {
  const breaks = await Break.find({
    slackUserId: userId,
    date: { $gte: startDate, $lte: endDate }
  });

  const totalMinutes = breaks.reduce((sum, b) => sum + b.durationMinutes, 0);
  const totalBreaks = breaks.length;
  const averagePerDay = totalBreaks > 0 ? totalMinutes / new Set(breaks.map(b => b.date)).size : 0;

  // Count reasons
  const reasonCounts: Record<string, number> = {};
  breaks.forEach(b => {
    const reason = b.reason.toLowerCase() || 'unspecified';
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  });

  return {
    totalMinutes,
    totalBreaks,
    averagePerDay: Math.round(averagePerDay),
    reasonCounts,
    breaks
  };
}
