import type { SayFn } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { format, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import dotenv from 'dotenv';
import standupThread from '../models/standupThread';
import StandupEntry from '../models/standupEntry';
import PerformanceMetrics from '../models/performanceMetrics';
import Achievement from '../models/achievements';
import Alert from '../models/alerts';
import { getUserName } from '../helper';
import { APP_TIMEZONE } from '../config';
import {
    formatIssueSummary,
    getActiveIssuesForUser,
    getIssueByIdentifier,
    getLinearUserByEmail,
    isLinearEnabled,
    testLinearConnection,
} from './linear.service';

const TIMEZONE = APP_TIMEZONE;
dotenv.config();
const timeStringToMinutes = (time?: string | null) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':').map((n) => parseInt(n, 10));
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return hours * 60 + minutes;
};

const formatTimeDisplay = (time?: string | null) => {
    if (!time) return '';
    const [hoursStr, minutesStr] = time.split(':');
    if (!hoursStr || !minutesStr) return '';
    const baseDate = toZonedTime(new Date(), TIMEZONE);
    baseDate.setHours(parseInt(hoursStr, 10), parseInt(minutesStr, 10), 0, 0);
    return format(baseDate, 'h:mm a');
};

const describeDayOffRange = (entry: any) => {
    const start = entry?.dayOffStartTime || '00:00';
    const end = entry?.dayOffEndTime || '23:59';
    if (start === '00:00' && end === '23:59') {
        return 'all day';
    }
    return `${formatTimeDisplay(start)} – ${formatTimeDisplay(end)}`.trim();
};

const describeMemberStatus = async (userId: string, checkDate?: string) => {
    const { name } = await getUserName(userId);
    const displayName = name || `User ${userId}`;
    const now = toZonedTime(new Date(), TIMEZONE);
    const todayStr = format(now, 'yyyy-MM-dd');
    const queryDate = checkDate || todayStr;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    
    const isToday = queryDate === todayStr;
    const isFuture = queryDate > todayStr;

    const todayEntry = await StandupEntry.findOne({
        slackUserId: userId,
        date: queryDate
    }).lean();

    const dayOffEntry = todayEntry?.isDayOff ? todayEntry : null;

    let statusEmoji = '✅';
    let statusLine = '';
    let upcomingLine = '';
    
    // Handle future date queries
    if (isFuture) {
        const dateLabel = format(new Date(`${queryDate}T00:00:00`), 'EEEE, MMM d');
        if (dayOffEntry) {
            const reason = dayOffEntry.dayOffReason || 'No reason provided';
            const rangeText = describeDayOffRange(dayOffEntry);
            statusEmoji = '🚫';
            statusLine = `${displayName} has scheduled time off on ${dateLabel} (${rangeText}). Reason: ${reason}.`;
        } else {
            statusEmoji = '❓';
            statusLine = `${displayName} hasn't indicated any time off for ${dateLabel}. They're expected to be working, but haven't submitted a standup yet for that day.`;
        }
    }
    // Handle today's status
    else if (isToday) {
        statusLine = `${displayName} is working today.`;
        
        if (dayOffEntry) {
            const startMinutes = timeStringToMinutes(dayOffEntry.dayOffStartTime) ?? 0;
            const endMinutes = timeStringToMinutes(dayOffEntry.dayOffEndTime) ?? (24 * 60 - 1);
            const reason = dayOffEntry.dayOffReason || 'No details provided';
            const rangeText = describeDayOffRange(dayOffEntry);

            if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) {
                statusEmoji = '🚫';
                statusLine = `${displayName} is out of the office right now (${rangeText}).`;
            } else if (nowMinutes < startMinutes) {
                statusEmoji = '⏰';
                statusLine = `${displayName} is working right now but will be out from ${rangeText}.`;
            } else {
                statusEmoji = '✅';
                statusLine = `${displayName} is back now (was out ${rangeText}).`;
            }

            statusLine += ` Reason: ${reason}.`;
        } else if (todayEntry) {
            statusEmoji = '✅';
            statusLine = `${displayName} submitted a standup today and is working.`;
        } else {
            statusEmoji = '❓';
            statusLine = `${displayName} hasn't submitted a standup yet today.`;
            const lastEntry = await StandupEntry.findOne({
                slackUserId: userId,
                date: { $lt: todayStr }
            }).sort({ date: -1 }).lean();

            if (lastEntry) {
                const lastLabel = format(new Date(`${lastEntry.date}T00:00:00`), 'EEEE, MMM d');
                statusLine += ` Last update was ${lastLabel}.`;
            } else {
                statusLine += ` No historical standups found.`;
            }
        }
    }
    // Handle past dates
    else {
        const dateLabel = format(new Date(`${queryDate}T00:00:00`), 'EEEE, MMM d');
        if (dayOffEntry) {
            const reason = dayOffEntry.dayOffReason || 'No reason provided';
            statusEmoji = '🚫';
            statusLine = `${displayName} was out on ${dateLabel}. Reason: ${reason}.`;
        } else if (todayEntry) {
            statusEmoji = '✅';
            statusLine = `${displayName} submitted a standup on ${dateLabel} and was working.`;
        } else {
            statusEmoji = '❓';
            statusLine = `${displayName} didn't submit a standup on ${dateLabel}.`;
        }
    }

    const nextEntry = await StandupEntry.findOne({
        slackUserId: userId,
        isDayOff: true,
        date: { $gt: todayStr }
    }).sort({ date: 1 }).lean();

    if (nextEntry) {
        const nextDate = new Date(`${nextEntry.date}T00:00:00`);
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = format(tomorrow, 'yyyy-MM-dd');
        
        let dateLabel;
        let whenPrefix = '';
        if (nextEntry.date === tomorrowStr) {
            dateLabel = 'tomorrow';
            whenPrefix = 'Tomorrow: ';
        } else {
            const daysDiff = Math.floor((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            if (daysDiff <= 7) {
                dateLabel = format(nextDate, 'EEEE'); // "Monday", "Tuesday", etc.
                whenPrefix = `${dateLabel}: `;
            } else {
                dateLabel = format(nextDate, 'EEEE, MMM d'); // "Monday, Nov 17"
                whenPrefix = `${dateLabel}: `;
            }
        }
        
        const reason = nextEntry.dayOffReason || '';
        const startTime = nextEntry.dayOffStartTime;
        const endTime = nextEntry.dayOffEndTime;
        
        let scheduleInfo;
        if (startTime && startTime !== '00:00') {
            scheduleInfo = `Starting late at ${formatTimeDisplay(startTime)}${reason ? ` (${reason})` : ''}`;
        } else if (endTime && endTime !== '23:59') {
            scheduleInfo = `Leaving early at ${formatTimeDisplay(endTime)}${reason ? ` (${reason})` : ''}`;
        } else {
            scheduleInfo = `Day off${reason ? ` (${reason})` : ''}`;
        }
        
        upcomingLine = ` ${whenPrefix}${scheduleInfo}.`;
    }

    return {
        statusEmoji,
        text: `${statusLine}${upcomingLine}`.trim(),
        statusLine,
        upcomingLine: upcomingLine.trim()
    };
};

const getTodayStandupContent = async (userId: string) => {
    const { name } = await getUserName(userId);
    const displayName = name || `User ${userId}`;
    const now = toZonedTime(new Date(), TIMEZONE);
    const todayStr = format(now, 'yyyy-MM-dd');
    
    const entry = await StandupEntry.findOne({
        slackUserId: userId,
        date: todayStr
    }).lean();
    
    if (!entry) {
        console.log(`[Standup] No standup found for ${displayName} today`);
        return '';
    }
    
    if (entry.isDayOff) {
        const startTime = entry.dayOffStartTime;
        const endTime = entry.dayOffEndTime;
        const reason = entry.dayOffReason || 'No reason provided';
        
        let timeInfo = '';
        if (startTime && startTime !== '00:00') {
            timeInfo = ` starting late at ${formatTimeDisplay(startTime)}`;
        } else if (endTime && endTime !== '23:59') {
            timeInfo = ` leaving early at ${formatTimeDisplay(endTime)}`;
        }
        
        return `${displayName} - Day off today${timeInfo}. Reason: ${reason}`;
    }
    
    const parts = [];
    if (entry.today) parts.push(`Today's work: ${entry.today}`);
    if (entry.yesterday) parts.push(`Yesterday completed: ${entry.yesterday}`);
    if (entry.blockers) parts.push(`Blockers: ${entry.blockers}`);
    if (entry.notes) parts.push(`Notes: ${entry.notes}`);
    
    if (parts.length === 0) {
        return '';
    }
    
    return `${displayName}'s standup:\n${parts.join('\n')}`;
};

const describeWorkForMember = async (userId: string) => {
    console.log(`[Linear] === describeWorkForMember called for userId: ${userId} ===`);
    
    if (!isLinearEnabled()) {
        console.log('[Linear] Linear integration is not enabled - LINEAR_API_KEY not configured');
        return ''; // Silently skip if Linear is not configured
    }
    
    console.log('[Linear] Linear is enabled, fetching user info...');

    const { name, email } = await getUserName(userId);
    const displayName = name || `User ${userId}`;
    
    console.log(`[Linear] User info - Name: ${displayName}, Email: ${email || 'NO EMAIL'}`);

    if (!email) {
        // Silently skip if no email - availability info is enough
        console.log(`[Linear] ❌ Skipping work summary for ${displayName} - no email in Slack profile`);
        return '';
    }

    console.log(`[Linear] Looking up Linear user for ${displayName} (${email})`);
    const linearUser = await getLinearUserByEmail(email);
    if (!linearUser) {
        console.log(`[Linear] No Linear user found for ${displayName} with email: ${email}`);
        return `\n\n_Note: ${displayName} doesn't have a Linear account linked with email ${email}, or Linear integration needs to be configured._`; // Show helpful message
    }

    console.log(`[Linear] Fetching issues for ${displayName} (Linear ID: ${linearUser.id})`);
    const issues = await getActiveIssuesForUser(linearUser.id);
    console.log(`[Linear] Found ${issues.length} issues for ${displayName}`);
    
    if (!issues.length) {
        return `${displayName} has no active Linear issues assigned right now.`;
    }

    // Group issues by status
    const grouped = new Map<string, typeof issues>();
    issues.forEach(issue => {
        const status = issue.state?.name || 'Unknown';
        if (!grouped.has(status)) {
            grouped.set(status, []);
        }
        grouped.get(status)!.push(issue);
    });

    // Define status order and icons
    const statusOrder = ['Backlog', 'Todo', 'In Progress', 'In Review', 'In Testing', 'Done', 'Canceled'];
    const statusIcons: Record<string, string> = {
        'Backlog': '📋',
        'Todo': '📝',
        'In Progress': '🔄',
        'In Review': '👀',
        'In Testing': '🧪',
        'Done': '✅',
        'Canceled': '❌'
    };

    const lines: string[] = [`*Linear Issues for ${displayName}:*\n`];
    
    // Sort statuses by defined order
    const sortedStatuses = Array.from(grouped.keys()).sort((a, b) => {
        const aIndex = statusOrder.findIndex(s => a.toLowerCase().includes(s.toLowerCase()));
        const bIndex = statusOrder.findIndex(s => b.toLowerCase().includes(s.toLowerCase()));
        if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
    });

    sortedStatuses.forEach(status => {
        const statusIssues = grouped.get(status)!;
        const icon = statusIcons[status] || Object.keys(statusIcons).find(k => status.toLowerCase().includes(k.toLowerCase())) 
            ? statusIcons[Object.keys(statusIcons).find(k => status.toLowerCase().includes(k.toLowerCase()))!] 
            : '📌';
        
        lines.push(`\n${icon} *${status}* (${statusIssues.length})`);
        statusIssues.forEach(issue => {
            const priority = issue.priorityLabel ? ` [${issue.priorityLabel}]` : '';
            lines.push(`  • ${issue.identifier}: ${issue.title}${priority}`);
        });
    });

    return lines.join('\n');
};

const describeIssueStatus = async (identifier: string) => {
    if (!isLinearEnabled()) {
        return 'Linear integration is not configured yet.';
    }

    try {
        const issue = await getIssueByIdentifier(identifier.toUpperCase());
        if (!issue) {
            return `I couldn't find the Linear issue ${identifier.toUpperCase()}. Make sure the issue exists and you have access to it.`;
        }

        return formatIssueSummary(issue);
    } catch (error: any) {
        console.error(`[Linear] Error fetching issue ${identifier}:`, error);
        return `There was an error fetching ${identifier.toUpperCase()} from Linear: ${error.message || 'Unknown error'}`;
    }
};

const handleStandupSummaryRequest = async ({
    event,
    client,
    say,
    threadTs,
}: {
    event: any;
    client: WebClient;
    say: SayFn;
    threadTs: string;
}) => {
    try {
        const result = await client.conversations.replies({
            channel: event.channel,
            ts: threadTs,
        });

        const replies = result.messages?.filter((m) => m.ts !== threadTs);
        if (!replies || replies.length === 0) {
            await say({
                thread_ts: threadTs,
                text: `No standup updates found in this thread.`,
            });
            return;
        }

        const summary = replies
            .map((m) => `• *<@${m.user}>*: ${m.text}`)
            .join('\n');

        await say({
            thread_ts: threadTs,
            text: `📋 *Standup Summary:*\n${summary}`,
        });
    } catch (error) {
        console.error('Error fetching thread replies:', error);
        await say({
            thread_ts: threadTs,
            text: `❌ Couldn't fetch the standup summary. Please try again later.`,
        });
    }
};

const extractMentionedUsers = (text: string, botUserId: string | null) => {
    const matches = Array.from(text.matchAll(/<@([A-Z0-9]+)>/g)).map((match) => match[1]);
    const unique = Array.from(new Set(matches));
    return unique.filter((id) => id !== botUserId);
};

const extractDateFromQuery = (text: string): string | null => {
    const normalized = text.toLowerCase();
    const now = toZonedTime(new Date(), TIMEZONE);
    
    // Check for "tomorrow"
    if (normalized.includes('tomorrow')) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return format(tomorrow, 'yyyy-MM-dd');
    }
    
    // Check for "yesterday"
    if (normalized.includes('yesterday')) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return format(yesterday, 'yyyy-MM-dd');
    }
    
    // Check for "today" or no date (default to today)
    return null; // null means today/default
};

const getRecentStandupHistory = async (userId: string, days: number = 7) => {
    const now = toZonedTime(new Date(), TIMEZONE);
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = format(startDate, 'yyyy-MM-dd');
    
    const entries = await StandupEntry.find({
        slackUserId: userId,
        date: { $gte: startDateStr }
    }).sort({ date: -1 }).limit(10).lean();
    
    return entries;
};

const getUserPerformanceMetrics = async (userId: string) => {
    const weekMetrics = await PerformanceMetrics.findOne({
        slackUserId: userId,
        period: 'week'
    }).sort({ startDate: -1 }).lean();

    const monthMetrics = await PerformanceMetrics.findOne({
        slackUserId: userId,
        period: 'month'
    }).sort({ startDate: -1 }).lean();

    return { weekMetrics, monthMetrics };
};

const getUserAchievements = async (userId: string) => {
    const achievements = await Achievement.find({
        slackUserId: userId,
        isActive: true
    }).sort({ earnedAt: -1 }).limit(5).lean();

    return achievements;
};

const getUserAlerts = async (userId: string) => {
    const now = toZonedTime(new Date(), TIMEZONE);
    const last7Days = subDays(now, 7);
    
    const alerts = await Alert.find({
        affectedUserId: userId,
        createdAt: { $gte: last7Days },
        status: { $in: ['active', 'acknowledged'] }
    }).sort({ createdAt: -1 }).limit(3).lean();

    return alerts;
};

const calculateStreak = async (userId: string) => {
    const now = toZonedTime(new Date(), TIMEZONE);
    let streak = 0;
    let checkDate = new Date(now);
    
    // Check backwards from today
    while (true) {
        const dateStr = format(checkDate, 'yyyy-MM-dd');
        const entry = await StandupEntry.findOne({
            slackUserId: userId,
            date: dateStr,
            isDayOff: false
        }).lean();
        
        if (!entry) {
            break;
        }
        
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
        
        // Safety limit
        if (streak > 100) break;
    }
    
    return streak;
};

const formatPerformanceBar = (score: number, maxWidth: number = 10): string => {
    const filled = Math.round((score / 100) * maxWidth);
    const empty = maxWidth - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
};

const getScoreEmoji = (score: number): string => {
    if (score >= 90) return '🔥';
    if (score >= 75) return '⭐';
    if (score >= 60) return '✅';
    if (score >= 40) return '⚠️';
    return '🔴';
};

const getRiskEmoji = (risk?: string): string => {
    if (risk === 'high') return '🔴';
    if (risk === 'medium') return '🟡';
    return '🟢';
};

const buildEnhancedUserProfile = async (userId: string) => {
    const { name } = await getUserName(userId);
    const displayName = name || `User ${userId}`;
    
    const [metrics, achievements, alerts, streak, recentEntries] = await Promise.all([
        getUserPerformanceMetrics(userId),
        getUserAchievements(userId),
        getUserAlerts(userId),
        calculateStreak(userId),
        getRecentStandupHistory(userId, 7)
    ]);

    const { weekMetrics, monthMetrics } = metrics;
    
    // Calculate additional stats
    const workDays = recentEntries.filter(e => !e.isDayOff).length;
    const offDays = recentEntries.filter(e => e.isDayOff).length;
    const submissionRate = workDays > 0 ? Math.round((workDays / 7) * 100) : 0;
    
    return {
        displayName,
        weekMetrics,
        monthMetrics,
        achievements,
        alerts,
        streak,
        recentEntries,
        workDays,
        offDays,
        submissionRate
    };
};

const buildGeneralContext = async (text: string, mentionedUsers: string[]) => {
    const contexts: string[] = [];
    
    // Get recent standup history for mentioned users
    for (const userId of mentionedUsers) {
        const { name } = await getUserName(userId);
        const displayName = name || `User ${userId}`;
        const entries = await getRecentStandupHistory(userId, 14); // Last 2 weeks
        
        if (entries.length === 0) {
            contexts.push(`${displayName}: No recent standup submissions found.`);
            continue;
        }
        
        const summaries = entries.map(entry => {
            const date = format(new Date(`${entry.date}T00:00:00`), 'MMM d');
            if (entry.isDayOff) {
                return `${date}: Day off - ${entry.dayOffReason || 'No reason provided'}`;
            }
            const parts = [];
            if (entry.yesterday) parts.push(`Yesterday: ${entry.yesterday}`);
            if (entry.today) parts.push(`Today: ${entry.today}`);
            if (entry.blockers) parts.push(`Blockers: ${entry.blockers}`);
            return `${date}: ${parts.join(' | ')}`;
        });
        
        contexts.push(`${displayName}'s recent activity:\n${summaries.join('\n')}`);
    }
    
    // If no users mentioned, check if they're asking about team-wide info
    if (mentionedUsers.length === 0) {
        const normalized = text.toLowerCase();
        if (normalized.includes('team') || normalized.includes('everyone') || normalized.includes('who')) {
            // Get recent activity for all team members
            const now = toZonedTime(new Date(), TIMEZONE);
            const todayStr = format(now, 'yyyy-MM-dd');
            const recentEntries = await StandupEntry.find({
                date: todayStr
            }).lean();
            
            const teamInfo = await Promise.all(
                recentEntries.slice(0, 10).map(async (entry) => {
                    const { name } = await getUserName(entry.slackUserId);
                    const displayName = name || `User ${entry.slackUserId}`;
                    if (entry.isDayOff) {
                        return `${displayName}: Day off - ${entry.dayOffReason || 'No reason'}`;
                    }
                    return `${displayName}: Working today`;
                })
            );
            
            contexts.push(`Today's team status:\n${teamInfo.join('\n')}`);
        }
    }
    
    return contexts;
};

export const mentionApp = async ({
    event,
    client,
    say,
}: {
    event: any;
    client: WebClient;
    say: SayFn;
}) => {
    const text = event.text || '';
    const normalized = text.toLowerCase();
    const now = new Date();
    const queryDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const standupThreads = await standupThread.findOne({ date: queryDate }).sort({ date: -1 }).lean();

    const threadTs = standupThreads?.threadTs || event.thread_ts || event.ts;

    // Handle help command
    if (normalized.includes('--help') || normalized.includes('-h') || (normalized.includes('help') && !normalized.includes('can you help'))) {
        await say({
            thread_ts: event.ts,
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: '📚 Standup Bot - Complete User Guide',
                        emoji: true
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `Hi <@${event.user}>! Here's your complete guide to using Standup Bot with all features and examples.`
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*🚀 1. Submit Your Daily Standup*\n\n*Basic Command:*\n`/standup`\nType this in any channel or DM to open the submission modal.\n\n*What to Share:*\n• ✅ What you accomplished yesterday\n• 📝 What you plan to do today\n• 🚧 Any blockers or challenges\n• 💬 Additional notes or context\n\n*When to Submit:*\nSubmit anytime, but daily reminders are sent at 9 AM Cairo time.'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*✈️ 2. Mark Out of Office (OOO)*\n\n*Quick OOO Today:*\n`/standup ooo <reason>`\n📌 *Example:* `/standup ooo taking my kid to the doctor`\n\n*Schedule Full Day Ahead:*\n`/standup ooo YYYY-MM-DD <reason>`\n📌 *Example:* `/standup ooo 2025-12-25 Christmas holiday`\n\n*Partial Day (Time Window):*\n`/standup ooo [date] HH:MM-HH:MM <reason>`\n📌 *Examples:*\n  • `/standup ooo today 1pm-3pm home repair`\n  • `/standup ooo 2025-11-20 13:00-15:00 dentist appointment`\n\n*Via Modal:*\nRun `/standup`, check "Out of office today?", set times & reason.\n\n*What Happens:*\n• 📢 Channel alert notifies your team\n• ✈️ Dashboard shows OOO badge\n• 💌 You receive DM confirmation\n• 📊 Profile tracks all your days off'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*💬 3. Ask the Bot - Availability & Status*\n\n*Check Who\'s Available:*\n• `@Standup where is @user?`\n• `@Standup is @user available?`\n• `@Standup @user\'s status`\n• `@Standup who\'s working today?`\n• `@Standup who is OOO today?`\n\n📌 *Try:* `@Standup where is @john tomorrow?`'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*🎯 4. Check Current Work & Tasks*\n\n*What Someone\'s Doing:*\n• `@Standup what is @user doing?`\n• `@Standup what is @user working on?`\n• `@Standup @user\'s current work`\n• `@Standup show me @user\'s tasks`\n• `@Standup what has @user been working on?`\n\n📌 *Try:* `@Standup what is @sarah working on today?`'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*🔧 5. Linear Integration (Ticket Status)*\n\n*Check Ticket Status:*\n• `@Standup status of ABC-123`\n• `@Standup check ticket SAK-456`\n• `@Standup what\'s the status of PROJ-789?`\n\n*Test Integration:*\n• `@Standup test linear`\n• `@Standup check linear`\n\n📌 *Try:* `@Standup status of SAK-123`\n\n*Shows:* Title, status, assignee, priority, state'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*📊 6. Performance Metrics & Stats*\n\n*Performance Queries:*\n• `@Standup how is @user performing?`\n• `@Standup @user\'s performance`\n• `@Standup @user stats`\n• `@Standup report on @user`\n\n*Full Profile (Everything):*\n• `@Standup profile of @user`\n• `@Standup tell me about @user`\n• `@Standup everything about @user`\n\n📌 *Try:* `@Standup profile of @mike`\n\n*Profile Includes:*\n• 🎯 Current availability & status\n• 📈 Performance scores (0-100)\n• 🔥 Current submission streak\n• 🏆 Earned badges & achievements\n• ⚠️ Active alerts & warnings\n• 📊 Weekly/monthly velocity\n• 💡 Submission-based highlights'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*🏆 7. Achievements & Badges System*\n\n*Streak Badges:*\n• 🔥 Week Warrior - 7 day streak\n• 🔥🔥 Month Master - 30 day streak\n• 🔥🔥🔥 Quarter Champion - 90 day streak\n• 🔥🔥🔥🔥 Consistency Legend - 180 day streak\n\n*Velocity Badges:*\n• ⚡ Speed Demon - 3+ tasks/day average\n• ⚡⚡ Productivity Pro - 5+ tasks/day\n• ⚡⚡⚡ Velocity Master - 8+ tasks/day\n\n*Early Bird Badges:*\n• 🌅 Morning Person - 50% submitted before 9 AM\n• 🌅🌅 Early Bird - 75% before 9 AM\n• 🌅🌅🌅 Dawn Warrior - 90% before 9 AM\n\n*Consistency Badges:*\n• 📊 Reliable Reporter - 80% submission rate\n• 📊📊 Consistency King - 90% submission rate\n• 📊📊📊 Perfect Attendance - 95% submission rate\n\n📌 *View yours:* `@Standup profile of @me`'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*🔔 8. Automatic Reminders & Schedule*\n\n*Daily Schedule (Cairo Time):*\n• *9:00 AM* 📢 Channel reminder\n• *10:00 AM* 📢 Huddle notification (15 mins warning)\n• *10:05 AM* 💌 DM to non-submitters\n• *11 AM-5 PM* 🔁 Hourly DM reminders (until you submit)\n\n*Weekly Schedule:*\n• *Monday 9 AM* - Week start message\n• *Thursday 5 PM* - Weekly report\n• *Friday 5 PM* - Week wrap-up\n\n*Monthly Schedule:*\n• *1st of month, 9 AM* - Monthly report\n\n*Other Jobs:*\n• *10 PM daily* - Alert checks & risk analysis\n• *11:30 PM daily* - Calculate performance metrics'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*📋 9. Standup Thread Summaries*\n\n*Get a thread recap:*\nIn any standup thread, mention:\n`@Standup standup`\n\n*You\'ll Get:*\n• 📋 Consolidated summary of the replies\n• 📊 Team status overview\n• ✨ Key highlights & progress\n• 🚧 Team blockers & challenges\n• 📝 Automatic categorization\n\n📌 *Try it in today\'s standup thread!*'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*🌐 10. Web Dashboards*\n\nVisit these dashboards in your browser:\n\n*Main Dashboards:*\n• `/` - Today\'s submissions overview\n• `/user/:userId` - Individual user report\n• `/manager` - Manager insights & alerts\n• `/analytics` - Team analytics with charts\n• `/history` - Historical thread view\n\n*Export Data (CSV):*\n• `/export/standups` - All submissions\n• `/export/metrics` - Performance metrics\n• `/export/alerts` - Alerts & warnings\n• `/export/achievements` - Badges earned\n• `/export/user/:userId` - Full user report\n\n🔒 *Note:* Requires authentication (Clerk)'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*🚨 11. Alerts & Risk Detection*\n\nThe bot automatically monitors:\n\n*Performance Alerts:*\n• 📉 Declining performance trends\n• 🔄 Recurring blockers\n• 😟 Negative sentiment patterns\n• 📊 Consistency drops\n• 🎯 Goal misalignment\n\n*Alert Levels:*\n• 🟢 Low - Minor concern\n• 🟡 Medium - Needs attention\n• 🔴 High - Immediate action needed\n\nManagers see these in the Manager Dashboard.'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*💡 12. Pro Tips & Best Practices*\n\n• 🗣️ *Ask naturally* - I understand conversational language!\n• 🔗 *Combine questions:* "Where is @user and what are they working on?"\n• ⏰ *Submit early* to avoid hourly reminders\n• 🎫 *Use ticket IDs* (ABC-123) for automatic Linear tracking\n• 📊 *Check dashboards* for trends and analytics\n• ⏱️ *Set partial OOO* for appointments (not full day off)\n• 🏆 *Build streaks* to earn achievement badges\n• 📈 *Review your profile* weekly to track improvement\n• 🤖 *Ask me anything* about your team - I\'m here to help!'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*🔗 Quick Command Examples*\n\n```bash\n# Submit standup\n/standup\n/standup ooo sick day\n/standup ooo 2025-12-25 holiday\n/standup ooo today 2pm-4pm doctor\n\n# Ask the bot\n@Standup where is @john?\n@Standup what is @sarah working on?\n@Standup profile of @mike\n@Standup status of SAK-123\n@Standup how is @jane performing?\n@Standup who\'s working today?\n@Standup test linear\n@Standup help\n```'
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'mrkdwn',
                            text: '🤖 Conversational and helpful • 📊 Integrated with Linear • 🔒 Secured by Clerk • 💬 Always Learning!'
                        }
                    ]
                }
            ],
            text: 'Standup Bot Help - Complete guide to all features, commands, and examples'
        });
        return;
    }

    if (normalized.includes('standup')) {
        await handleStandupSummaryRequest({ event, client, say, threadTs });
        return;
    }

    // Test Linear connection
    if (normalized.includes('test linear') || normalized.includes('check linear')) {
        const result = await testLinearConnection();
        await say({
            thread_ts: event.ts,
            text: result.success 
                ? `✅ Linear integration is working! ${result.message}` 
                : `❌ Linear integration failed: ${result.message}`,
        });
        return;
    }

    let botUserId: string | null = null;
    let mentionedUsers: string[] = [];
    if (text.includes('<@')) {
        try {
            const auth = await client.auth.test();
            botUserId = auth.user_id || null;
        } catch (err) {
            console.error('Error fetching bot user id:', err);
        }
        mentionedUsers = extractMentionedUsers(text, botUserId);
    }

    const hasMentions = mentionedUsers.length > 0;
    const needsMention = normalized.includes('where') ||
        normalized.includes('ooo') ||
        normalized.includes('working') ||
        normalized.includes('doing') ||
        normalized.includes('up to');
    if (needsMention && !hasMentions) {
        await say({
            thread_ts: event.ts,
            text: `Please mention who you're asking about, e.g. \`where is @username?\` or \`what is @username working on?\``,
        });
        return;
    }

    const hasTicketKeyword = normalized.includes('ticket') || normalized.includes('issue');
    const issueMatches = text.match(/\b[A-Z][A-Z0-9]+-\d+\b/gi) || [];
    const wantsTicketStatus = hasTicketKeyword || issueMatches.length > 0;
    
    console.log(`[DEBUG] Text: "${text}"`);
    console.log(`[DEBUG] Has ticket keyword: ${hasTicketKeyword}`);
    console.log(`[DEBUG] Issue matches: ${JSON.stringify(issueMatches)}`);
    console.log(`[DEBUG] Wants ticket status: ${wantsTicketStatus}`);
    let wantsAvailability = hasMentions && (normalized.includes('where') || normalized.includes('ooo') || (normalized.includes('status') && !hasTicketKeyword));
    let wantsWorkSummary = hasMentions && (normalized.includes('working on') || normalized.includes('working') || normalized.includes('doing') || normalized.includes('up to'));
    let wantsPerformance = hasMentions && (
        normalized.includes('performance') || 
        normalized.includes('metrics') || 
        normalized.includes('how is') ||
        normalized.includes('report') ||
        normalized.includes('profile') ||
        normalized.includes('stats') ||
        normalized.includes('progress')
    );
    let wantsFullProfile = hasMentions && (
        normalized.includes('about') || 
        normalized.includes('profile') || 
        normalized.includes('everything') ||
        normalized.includes('full report') ||
        normalized.includes('detailed')
    );

    // Always show availability when asking about someone
    if (hasMentions && !wantsAvailability && !wantsWorkSummary && !wantsPerformance && !wantsFullProfile) {
        wantsAvailability = true;
        wantsWorkSummary = true; // Always try to show what they're working on (from standup)
    } else if (wantsWorkSummary) {
        // If asking about work, also include availability
        wantsAvailability = true;
    }
    
    // Full profile includes everything
    if (wantsFullProfile) {
        wantsAvailability = true;
        wantsWorkSummary = true;
        wantsPerformance = true;
    }

    const contexts: string[] = [];
    const statusResults: any[] = [];
    const profileData: any[] = [];

    // Handle full profile requests with rich Block Kit UI
    if (wantsPerformance || wantsFullProfile) {
        for (const userId of mentionedUsers) {
            const profile = await buildEnhancedUserProfile(userId);
            profileData.push(profile);
            
            // Build rich blocks for this user
            const blocks: any[] = [];
            
            // Header with name and status
            const statusData = await describeMemberStatus(userId);
            blocks.push({
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: `📊 ${profile.displayName}'s Profile`,
                    emoji: true
                }
            });
            
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `${statusData.statusEmoji} *Status:* ${statusData.statusLine}`
                }
            });
            
            // Performance Metrics Section
            if (profile.weekMetrics || profile.monthMetrics) {
                blocks.push({ type: 'divider' });
                
                const metricsFields: any[] = [];
                
                if (profile.weekMetrics) {
                    const wm = profile.weekMetrics;
                    metricsFields.push({
                        type: 'mrkdwn',
                        text: `*Weekly Performance*\n${getScoreEmoji(wm.overallScore)} Score: *${wm.overallScore}/100*\n${formatPerformanceBar(wm.overallScore)}`
                    });
                    metricsFields.push({
                        type: 'mrkdwn',
                        text: `*Consistency*\n${wm.totalSubmissions}/${wm.expectedSubmissions} submissions\n${wm.consistencyScore}% rate`
                    });
                }
                
                if (profile.monthMetrics) {
                    const mm = profile.monthMetrics;
                    metricsFields.push({
                        type: 'mrkdwn',
                        text: `*Monthly Velocity*\n📈 ${mm.totalTasksCompleted} tasks done\n⚡ ${mm.averageTasksPerDay.toFixed(1)} per day`
                    });
                    metricsFields.push({
                        type: 'mrkdwn',
                        text: `*Team Ranking*\n🏆 Top ${100 - mm.percentileRank}%\n${mm.percentileRank > 50 ? '⭐' : '💪'} Percentile: ${mm.percentileRank}th`
                    });
                }
                
                if (metricsFields.length > 0) {
                    blocks.push({
                        type: 'section',
                        fields: metricsFields
                    });
                }
            }
            
            // Streak & Activity
            blocks.push({ type: 'divider' });
            const activityFields: any[] = [
                {
                    type: 'mrkdwn',
                    text: `*🔥 Current Streak*\n${profile.streak} day${profile.streak !== 1 ? 's' : ''}`
                },
                {
                    type: 'mrkdwn',
                    text: `*📅 Last 7 Days*\n${profile.workDays} work days\n${profile.offDays} days off`
                }
            ];
            
            if (profile.weekMetrics) {
                activityFields.push({
                    type: 'mrkdwn',
                    text: `*⏰ Avg Submit Time*\n${profile.weekMetrics.averageSubmissionTime || 'N/A'}`
                });
                activityFields.push({
                    type: 'mrkdwn',
                    text: `*${getRiskEmoji(profile.weekMetrics.riskLevel)} Risk Level*\n${profile.weekMetrics.riskLevel?.toUpperCase() || 'LOW'}`
                });
            }
            
            blocks.push({
                type: 'section',
                fields: activityFields
            });
            
            // Achievements
            if (profile.achievements && profile.achievements.length > 0) {
                blocks.push({ type: 'divider' });
                const badgeText = profile.achievements
                    .map(a => `${a.badgeIcon} *${a.badgeName}* (${a.level})`)
                    .join('\n');
                blocks.push({
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*🏅 Recent Achievements*\n${badgeText}`
                    }
                });
            }
            
            // Active Alerts/Issues
            if (profile.alerts && profile.alerts.length > 0) {
                blocks.push({ type: 'divider' });
                const alertText = profile.alerts
                    .map(a => `⚠️ ${a.title} (${a.severity})`)
                    .join('\n');
                blocks.push({
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*⚠️ Active Alerts*\n${alertText}`
                    }
                });
            }
            
            // Recent Work (if requested)
            if (wantsWorkSummary || wantsFullProfile) {
                const standupContent = await getTodayStandupContent(userId);
                if (standupContent) {
                    blocks.push({ type: 'divider' });
                    blocks.push({
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*📝 Today's Standup*\n${standupContent.replace(`${profile.displayName}'s standup:\n`, '')}`
                        }
                    });
                }
                
                // Add Linear issues
                const workText = await describeWorkForMember(userId);
                if (workText) {
                    blocks.push({
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*🎯 ${workText}*`
                        }
                    });
                }
            }
            
            // Footer with insights
            if (profile.weekMetrics?.riskFactors && profile.weekMetrics.riskFactors.length > 0) {
                blocks.push({ type: 'divider' });
                blocks.push({
                    type: 'context',
                    elements: [{
                        type: 'mrkdwn',
                        text: `💡 *Insights:* ${profile.weekMetrics.riskFactors.join(' • ')}`
                    }]
                });
            }
            
            await say({
                thread_ts: event.ts,
                blocks: blocks,
                text: `Profile for ${profile.displayName}`
            });
        }
        return; // Exit after showing rich profile
    }

    if (wantsAvailability) {
        // Extract date from query (tomorrow, yesterday, etc.)
        const queryDate = extractDateFromQuery(text);
        
        for (const userId of mentionedUsers) {
            const statusData = await describeMemberStatus(userId, queryDate || undefined);
            statusResults.push(statusData);
            contexts.push(statusData.text);
        }
    }

    if (wantsWorkSummary) {
        console.log(`[DEBUG] wantsWorkSummary = true, processing ${mentionedUsers.length} users`);
        for (const userId of mentionedUsers) {
            console.log(`[DEBUG] Processing work summary for userId: ${userId}`);
            
            // First priority: Get actual standup content (what they wrote today)
            const standupContent = await getTodayStandupContent(userId);
            if (standupContent) {
                console.log(`[DEBUG] Got standup content, length: ${standupContent.length}`);
                contexts.push(standupContent);
            } else {
                console.log(`[DEBUG] No standup content found`);
            }
            
            // Second priority: Add Linear issues if available
            console.log(`[DEBUG] Calling describeWorkForMember for userId: ${userId}`);
            const workText = await describeWorkForMember(userId);
            console.log(`[DEBUG] describeWorkForMember returned: ${workText ? `"${workText.substring(0, 100)}..."` : 'EMPTY/NULL'}`);
            if (workText) {
                contexts.push(workText);
                console.log(`[DEBUG] Added Linear work text to contexts`);
            } else {
                console.log(`[DEBUG] ❌ workText is empty, not adding to contexts`);
            }
        }
    }

    if (wantsTicketStatus) {
        if (issueMatches.length === 0) {
            contexts.push('Please include a ticket identifier like "ABC-123" so I know which Linear issue to look up.');
        } else {
            for (const rawId of issueMatches) {
                console.log(`[DEBUG] Looking up Linear issue: ${rawId}`);
                const summary = await describeIssueStatus(rawId);
                console.log(`[DEBUG] Linear issue summary: ${summary}`);
                contexts.push(summary);
            }
        }
    }

    console.log(`[DEBUG] Total contexts collected: ${contexts.length}`, contexts);

    // If no specific contexts were collected, try general question answering
    if (contexts.length === 0) {
        console.log('[DEBUG] No specific contexts, trying general Q&A');
        const generalContexts = await buildGeneralContext(text, mentionedUsers);
        if (generalContexts.length > 0) {
            contexts.push(...generalContexts);
            console.log(`[DEBUG] Added ${generalContexts.length} general contexts`);
        }
    }

    if (contexts.length > 0) {
        // Check if we have Linear work data (contains grouped status formatting)
        const hasLinearData = contexts.some(c => c.includes('Linear Issues for') || c.includes('📋') || c.includes('📝') || c.includes('🔄'));
        const combined = contexts.join('\n\n');
        
        // If we have structured status results, use Block Kit formatting with enhanced layout
        if (statusResults.length > 0 && !wantsWorkSummary && !wantsTicketStatus) {
            const blocks: any[] = [];
            
            // Add detailed status information
            for (const statusData of statusResults) {
                blocks.push({
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `${statusData.statusEmoji} ${statusData.statusLine}`
                    }
                });
                
                if (statusData.upcomingLine) {
                    blocks.push({
                        type: 'context',
                        elements: [
                            {
                                type: 'mrkdwn',
                                text: `📅 ${statusData.upcomingLine}`
                            }
                        ]
                    });
                }
            }
            
            await say({
                thread_ts: event.ts,
                blocks: blocks,
                text: combined,
            });
            return;
        }
        
        // If we have Linear data with formatting, preserve it by using blocks
        if (hasLinearData) {
            const blocks: any[] = [];
            
            // Split contexts to separate standup content from Linear data
            contexts.forEach(context => {
                if (context.includes('Linear Issues for')) {
                    // This is Linear data - preserve formatting
                    blocks.push({
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: context
                        }
                    });
                } else {
                    // This is standup or other content
                    blocks.push({
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: context
                        }
                    });
                }
            });
            
            await say({
                thread_ts: event.ts,
                blocks: blocks,
                text: combined // Fallback text
            });
            return;
        }
        
        await say({
            thread_ts: event.ts,
            text: combined,
        });
        return;
    }

    await say({
        thread_ts: event.ts,
        blocks: [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: '👋 Hi! I\'m Standup Bot',
                    emoji: true
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                text: `Hi <@${event.user}>! I'm your team intelligence assistant built on standup data. I can help you with standups, team status, performance tracking, and much more!`
                }
            },
            {
                type: 'divider'
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*🚀 Quick Start:*\n\n• Type \`/standup\` to submit your daily standup\n• Type \`@Standup help\` to see the complete guide\n• Ask me naturally: "Where is @user?" or "What is @user working on?"`
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*🔍 Popular Commands:*\n• \`@Standup where is @user?\` - Check availability\n• \`@Standup profile of @user\` - Full profile & badges\n• \`@Standup status of ABC-123\` - Linear ticket status\n• \`@Standup who\'s working today?\` - Team overview`
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*✈️ Mark Out of Office:*\n• \`/standup ooo sick day\`\n• \`/standup ooo 2025-12-25 holiday\`\n• \`/standup ooo today 2pm-4pm doctor\``
                }
            },
            {
                type: 'divider'
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*💡 What I Can Do:*\n• 📊 Track performance & streaks\n• 🏆 Award achievement badges\n• 🔔 Send smart reminders\n• 📋 Summarize standup threads\n• 📈 Analyze team trends\n• ⚠️ Detect risks & blockers\n• 🎯 Integrate with Linear`
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*📚 Need More Info?*\n\nType \`@Standup help\` or \`@Standup --help\` to see:\n• Complete feature list with examples\n• All achievement badges\n• Reminder schedule\n• Web dashboard links\n• Pro tips & best practices`
                }
            },
            {
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                    text: '🤖 I understand natural language - just ask! | 📊 Integrated with Linear'
                    }
                ]
            }
        ],
        text: `Hi! I'm Standup Bot. Type @Standup help for the complete guide, or ask me anything about your team!`,
    });
};
