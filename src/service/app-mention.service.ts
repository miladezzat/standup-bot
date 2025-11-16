import type { AppMentionEvent, SayFn } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
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
    const displayName = name ? `<@${userId}> (${name})` : `<@${userId}>`;
    const now = toZonedTime(new Date(), TIMEZONE);
    const todayStr = format(now, 'yyyy-MM-dd');
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const todayEntry = await StandupEntry.findOne({
        slackUserId: userId,
        date: todayStr
    }).lean();

    const dayOffEntry = todayEntry?.isDayOff ? todayEntry : null;

    let statusLine = `${displayName} is working today.`;
    let upcomingLine = '';

    if (dayOffEntry) {
        const startMinutes = timeStringToMinutes(dayOffEntry.dayOffStartTime) ?? 0;
        const endMinutes = timeStringToMinutes(dayOffEntry.dayOffEndTime) ?? (24 * 60 - 1);
        const reason = dayOffEntry.dayOffReason || 'No details provided';
        const rangeText = describeDayOffRange(dayOffEntry);

        if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) {
            statusLine = `${displayName} is out of the office right now (${rangeText}).`;
        } else if (nowMinutes < startMinutes) {
            statusLine = `${displayName} is working right now but will be out from ${rangeText}.`;
        } else {
            statusLine = `${displayName} is back now (was out ${rangeText}).`;
        }

        statusLine += ` Reason: ${reason}.`;
    } else if (todayEntry) {
        statusLine = `${displayName} submitted a standup today and is working.`;
    } else {
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

    return `${statusLine}${upcomingLine}`.trim();
};

const describeWorkForMember = async (userId: string) => {
    if (!isLinearEnabled()) {
        return 'Linear integration is not configured yet.';
    }

    const { name, email } = await getUserName(userId);
    const displayName = name ? `<@${userId}> (${name})` : `<@${userId}>`;

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
    return `Here’s what ${displayName} is working on:\n${lines.join('\n')}`;
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
        const prompt = `You are a concise engineering team assistant. Answer the user's question using ONLY the provided data. If something isn't covered, say you don't know.\n\nQuestion:\n${question}\n\nContext:\n${contextText}\n\nProvide a short, direct answer.`;
        const completion = await openaiClient.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.4,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 300,
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

    if (wantsAvailability) {
        for (const userId of mentionedUsers) {
            const statusText = await describeMemberStatus(userId);
            contexts.push(statusText);
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
        let combined = contexts.join('\n\n');
        const aiAnswer = await generateAIResponse(text, contexts);
        if (aiAnswer && !/i\s+don't\s+know/i.test(aiAnswer.trim())) {
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
