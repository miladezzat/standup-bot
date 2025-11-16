import type { AppMentionEvent, SayFn } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { format, subDays, differenceInDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import dotenv from 'dotenv';
import OpenAI from 'openai';
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
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
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
    if (!isLinearEnabled()) {
        return ''; // Silently skip if Linear is not configured
    }

    const { name, email } = await getUserName(userId);
    const displayName = name || `User ${userId}`;

    if (!email) {
        // Silently skip if no email - availability info is enough
        console.log(`[Linear] Skipping work summary for ${displayName} - no email in Slack profile`);
        return '';
    }

    const linearUser = await getLinearUserByEmail(email);
    if (!linearUser) {
        console.log(`[Linear] Skipping work summary for ${displayName} - no Linear user found for ${email}`);
        return ''; // Silently skip if not in Linear
    }

    const issues = await getActiveIssuesForUser(linearUser.id);
    if (!issues.length) {
        return `${displayName} has no active Linear issues assigned right now.`;
    }

    const lines = issues.slice(0, 5).map((issue) => `• ${formatIssueSummary(issue)}`);
    return `Here's what ${displayName} is working on:\n${lines.join('\n')}`;
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
    event: AppMentionEvent;
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

const generateAIResponse = async (question: string, contexts: string[]): Promise<string> => {
    const contextText = contexts.filter(Boolean).join('\n\n');
    if (!contextText) {
        return 'I don\'t have any information to answer that question right now.';
    }
    if (!openaiClient) {
        // No AI available, return raw context
        return contextText;
    }
    try {
        const prompt = `You are a team standup assistant. Answer the question using ONLY the information provided below. 

CRITICAL RULES:
- Use ONLY the facts from the "Information" section
- If the information doesn't contain the answer, say "I don't have that information in the standup data"
- DO NOT make up or infer details not explicitly stated
- DO NOT hallucinate appointments, meetings, or reasons not mentioned
- Be accurate and factual

Question: ${question}

Information:
${contextText}

Answer briefly and accurately (2-3 sentences max):`;
        
        const completion = await openaiClient.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.1, // Lower temperature for more factual responses
            messages: [
                { 
                    role: 'system', 
                    content: 'You are a factual assistant that only reports information explicitly provided. Never make assumptions or add details not in the source data.' 
                },
                { 
                    role: 'user', 
                    content: prompt 
                }
            ],
            max_tokens: 150,
        });
        
        const aiResponse = completion.choices[0]?.message?.content?.trim();
        
        // If AI says it doesn't know, fall back to raw context
        if (aiResponse && (
            aiResponse.toLowerCase().includes("don't have") || 
            aiResponse.toLowerCase().includes("no information") ||
            aiResponse.toLowerCase().includes("not found")
        )) {
            return contextText; // Return raw data instead of "I don't know"
        }
        
        return aiResponse || contextText;
    } catch (error) {
        console.error('Error generating AI response:', error);
        return contextText;
    }
};

export const mentionApp = async ({
    event,
    client,
    say,
}: {
    event: AppMentionEvent;
    client: WebClient;
    say: SayFn;
}) => {
    const text = event.text || '';
    const normalized = text.toLowerCase();
    const now = new Date();
    const queryDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const standupThreads = await standupThread.findOne({ date: queryDate }).sort({ date: -1 }).lean();

    const threadTs = standupThreads?.threadTs || event.thread_ts || event.ts;

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
        for (const userId of mentionedUsers) {
            // First priority: Get actual standup content (what they wrote today)
            const standupContent = await getTodayStandupContent(userId);
            if (standupContent) {
                contexts.push(standupContent);
            }
            
            // Second priority: Add Linear issues if available
            const workText = await describeWorkForMember(userId);
            if (workText) {
                contexts.push(workText);
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
        // Generate AI response for more natural language
        const aiAnswer = await generateAIResponse(text, contexts);
        console.log(`[DEBUG] AI Answer: "${aiAnswer}"`);
        const useAI = aiAnswer && !/i\s+don't\s+know/i.test(aiAnswer.trim());
        console.log(`[DEBUG] Use AI: ${useAI}`);
        
        // If we have structured status results, use Block Kit formatting with AI enhancement
        if (statusResults.length > 0 && !wantsWorkSummary && !wantsTicketStatus) {
            const blocks: any[] = [];
            
            // Add AI-generated summary at the top if available
            if (useAI) {
                blocks.push({
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `💬 ${aiAnswer}`
                    }
                });
                blocks.push({
                    type: 'divider'
                });
            }
            
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
                text: useAI ? aiAnswer : contexts.join('\n\n'), // Fallback text
            });
            return;
        }
        
        // For other cases (work summary, ticket status, etc.), use AI-enhanced text format
        let combined = contexts.join('\n\n');
        if (useAI) {
            combined = aiAnswer;
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
                    text: '👋 Standup Bot - Your Team Intelligence Assistant',
                    emoji: true
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `Hi <@${event.user}>! I can help you understand your team better. Here's what I can do:`
                }
            },
            {
                type: 'divider'
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*🔍 Quick Status Checks:*\n• \`@Standup where is @username?\` - Check availability & OOO status\n• \`@Standup what is @username doing?\` - Current work & today's standup\n• \`@Standup status of SAK-123\` - Linear ticket status & details`
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*📊 Performance & Insights:*\n• \`@Standup how is @username performing?\` - Performance metrics & scores\n• \`@Standup @username's stats\` - Weekly/monthly statistics\n• \`@Standup profile of @username\` - Full detailed profile with achievements\n• \`@Standup report on @username\` - Comprehensive performance report`
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*💬 Natural Questions:*\n• \`@Standup what has @username been working on?\` - Recent activity & history\n• \`@Standup show me @username's progress\` - Work summary & velocity\n• \`@Standup what blockers did @username face?\` - Recent blockers & issues\n• \`@Standup who's working today?\` - Team overview & availability`
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*📋 Summaries:*\n• Mention me with \`standup\` in a standup thread for instant summaries\n• \`@Standup test linear\` - Check Linear integration status`
                }
            },
            {
                type: 'divider'
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*📈 What You'll See in Profiles:*\n• 🔥 Performance scores & consistency ratings\n• 📊 Weekly/monthly velocity & task completion\n• 🏆 Achievements & badges earned\n• ⚠️ Active alerts & risk levels\n• 🎯 Current Linear issues & assignments\n• 📅 Streak tracking & submission patterns\n• 💡 AI-generated insights & recommendations`
                }
            },
            {
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: '🤖 Powered by AI - Just ask naturally and I\'ll understand! | 💡 Try: "Tell me everything about @username"'
                    }
                ]
            }
        ],
        text: `Hi! I can help you check team member availability, work status, performance metrics, achievements, and answer questions about your team.`,
    });
};
