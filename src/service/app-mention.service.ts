import type { AppMentionEvent, SayFn } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import standupThread from '../models/standupThread';
import StandupEntry from '../models/standupEntry';
import { getUserName } from '../helper';
import {
    formatIssueSummary,
    getActiveIssuesForUser,
    getIssueByIdentifier,
    getLinearUserByEmail,
    isLinearEnabled,
    testLinearConnection,
} from './linear.service';

const TIMEZONE = 'Africa/Cairo';
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

const describeMemberStatus = async (userId: string) => {
    const { name } = await getUserName(userId);
    const displayName = name || `User ${userId}`;
    const now = toZonedTime(new Date(), TIMEZONE);
    const todayStr = format(now, 'yyyy-MM-dd');
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const todayEntry = await StandupEntry.findOne({
        slackUserId: userId,
        date: todayStr
    }).lean();

    const dayOffEntry = todayEntry?.isDayOff ? todayEntry : null;

    let statusEmoji = '✅';
    let statusLine = `${displayName} is working today.`;
    let upcomingLine = '';

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
        if (nextEntry.date === tomorrowStr) {
            dateLabel = 'tomorrow';
        } else {
            const daysDiff = Math.floor((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            if (daysDiff <= 7) {
                dateLabel = format(nextDate, 'EEEE'); // "Monday", "Tuesday", etc.
            } else {
                dateLabel = format(nextDate, 'EEEE, MMM d'); // "Monday, Nov 17"
            }
        }
        
        const reason = nextEntry.dayOffReason || 'No details provided';
        const rangeText = describeDayOffRange(nextEntry);
        upcomingLine = ` Next day off: ${dateLabel} (${rangeText}). Reason: ${reason}.`;
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
        return 'I could not find any relevant data to answer that right now.';
    }
    if (!openaiClient) {
        return contextText;
    }
    try {
        const prompt = `You are a helpful team assistant. Answer the question directly with actual information from the standup data.

CRITICAL RULES:
- READ CAREFULLY: "Next day off: Monday" means FUTURE, not today!
- TODAY vs FUTURE: If it says "working today" and "Next day off: Monday", they ARE WORKING TODAY
- BE SPECIFIC: Mention actual tasks from their standup
- TIME DETAILS: If "starting late at 12 PM", include that detail
- NO VAGUE PHRASES: Don't say "working on tasks", use their actual work items
- NO MISINTERPRETATION: Don't confuse future plans with current status
- JUST THE FACTS: Quote their actual work, don't make up details
- BE CONCISE: 2-3 sentences maximum

Examples of CORRECT answers:
- "John is working today on fixing the login bug and adding new features. He'll be off tomorrow."
- "Sarah is working today but starting late at 2 PM for a doctor's appointment."

Examples of WRONG answers:
- "John is not available" (when data says "working today")
- "Sarah is off today" (when data says "Next day off: Friday")

Question: ${question}

Standup Data:
${contextText}

Give a direct, accurate answer (don't confuse today with future):`;
        
        const completion = await openaiClient.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.1,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
        });
        return completion.choices[0]?.message?.content?.trim() || contextText;
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

    // Always show availability when asking about someone
    if (hasMentions && !wantsAvailability && !wantsWorkSummary) {
        wantsAvailability = true;
        wantsWorkSummary = true; // Always try to show what they're working on (from standup)
    } else if (wantsWorkSummary) {
        // If asking about work, also include availability
        wantsAvailability = true;
    }

    const contexts: string[] = [];
    const statusResults: any[] = [];

    if (wantsAvailability) {
        for (const userId of mentionedUsers) {
            const statusData = await describeMemberStatus(userId);
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
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `👋 Hi <@${event.user}>! Here's what I can help you with:`
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Quick Status Checks:*\n• \`@Standup where is @username?\` - Check availability\n• \`@Standup what is @username doing?\` - Current work & status\n• \`@Standup status of SAK-123\` - Linear ticket status`
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*General Questions:*\n• \`@Standup what has @username been working on?\` - Recent activity\n• \`@Standup show me @username's progress\` - Work summary\n• \`@Standup what blockers did @username face?\` - Recent issues\n• \`@Standup who's working today?\` - Team overview`
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Summaries:*\n• Mention me with \`standup\` in a standup thread for summaries`
                }
            },
            {
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: '💡 Just ask me questions naturally - I use AI to understand and answer!'
                    }
                ]
            }
        ],
        text: `Hi! I can help you check team member availability, work status, Linear tickets, and answer general questions about recent standups.`,
    });
};
