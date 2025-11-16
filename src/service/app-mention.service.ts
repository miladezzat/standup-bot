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
        const dateLabel = format(new Date(`${nextEntry.date}T00:00:00`), 'EEEE, MMM d');
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

const describeWorkForMember = async (userId: string) => {
    if (!isLinearEnabled()) {
        return 'Linear integration is not configured yet.';
    }

    const { name, email } = await getUserName(userId);
    const displayName = name || `User ${userId}`;

    if (!email) {
        return `${displayName}: Slack profile is missing an email, so I can't look them up in Linear.`;
    }

    const linearUser = await getLinearUserByEmail(email);
    if (!linearUser) {
        return `${displayName}: I couldn't find a Linear user with the email ${email}.`;
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

    const issue = await getIssueByIdentifier(identifier.toUpperCase());
    if (!issue) {
        return `I couldn't find the Linear issue ${identifier.toUpperCase()}.`;
    }

    return formatIssueSummary(issue);
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

const generateAIResponse = async (question: string, contexts: string[]): Promise<string> => {
    const contextText = contexts.filter(Boolean).join('\n\n');
    if (!contextText) {
        return 'I could not find any relevant data to answer that right now.';
    }
    if (!openaiClient) {
        return contextText;
    }
    try {
        const prompt = `You are a friendly and helpful engineering team assistant. Your goal is to answer the user's question in a natural, conversational way.

Guidelines:
- Be warm and personable while remaining professional
- Answer directly and concisely, but in natural language
- Use the provided context data to inform your answer
- Don't just repeat the data - synthesize it into a helpful response
- If the person is available, be positive and upbeat
- If they're out of office, acknowledge it naturally
- Use casual language like "right now", "currently", "at the moment"
- Don't use phrases like "according to the data" or "based on the information" - just answer naturally
- Keep your response to 2-3 sentences maximum

Question: ${question}

Context Data:
${contextText}

Provide a natural, friendly response:`;
        
        const completion = await openaiClient.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.7,
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
    let wantsAvailability = hasMentions && (normalized.includes('where') || normalized.includes('ooo') || (normalized.includes('status') && !hasTicketKeyword));
    let wantsWorkSummary = hasMentions && (normalized.includes('working on') || normalized.includes('working') || normalized.includes('doing') || normalized.includes('up to'));

    if (hasMentions && !wantsAvailability && !wantsWorkSummary) {
        wantsAvailability = true;
        wantsWorkSummary = isLinearEnabled();
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
            const workText = await describeWorkForMember(userId);
            contexts.push(workText);
        }
    }

    if (wantsTicketStatus) {
        if (issueMatches.length === 0) {
            contexts.push('Please include a ticket identifier like "ABC-123" so I know which Linear issue to look up.');
        } else {
            for (const rawId of issueMatches) {
                const summary = await describeIssueStatus(rawId);
                contexts.push(summary);
            }
        }
    }

    if (contexts.length > 0) {
        // Generate AI response for more natural language
        const aiAnswer = await generateAIResponse(text, contexts);
        const useAI = aiAnswer && !/i\s+don't\s+know/i.test(aiAnswer.trim());
        
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
        text: `Hi <@${event.user}>, mention me with \`standup\` in a standup thread for summaries, tag teammates to ask about their availability or current work, or include a Linear ticket ID (e.g. ABC-123) to get its status.`,
    });
};
