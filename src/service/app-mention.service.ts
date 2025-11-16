import type { AppMentionEvent, SayFn } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import standupThread from '../models/standupThread';
import StandupEntry from '../models/standupEntry';
import { getUserName } from '../helper';

const TIMEZONE = 'Africa/Cairo';

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
        date: todayStr,
        isDayOff: true
    }).lean();

    let statusLine = `${displayName} is working today.`;
    let upcomingLine = '';

    if (todayEntry) {
        const startMinutes = timeStringToMinutes(todayEntry.dayOffStartTime) ?? 0;
        const endMinutes = timeStringToMinutes(todayEntry.dayOffEndTime) ?? (24 * 60 - 1);
        const reason = todayEntry.dayOffReason || 'No details provided';
        const rangeText = describeDayOffRange(todayEntry);

        if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) {
            statusLine = `${displayName} is out of the office right now (${rangeText}).`;
        } else if (nowMinutes < startMinutes) {
            statusLine = `${displayName} is working right now but will be out from ${rangeText}.`;
        } else {
            statusLine = `${displayName} is back now (was out ${rangeText}).`;
        }

        statusLine += ` Reason: ${reason}.`;

        if (nowMinutes < startMinutes) {
            upcomingLine = '';
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

    if (normalized.includes('where') || normalized.includes('status') || normalized.includes('ooo')) {
        let botUserId: string | null = null;
        try {
            const auth = await client.auth.test();
            botUserId = auth.user_id || null;
        } catch (err) {
            console.error('Error fetching bot user id:', err);
        }

        const mentionedUsers = extractMentionedUsers(text, botUserId);
        if (mentionedUsers.length === 0) {
            await say({
                thread_ts: event.ts,
                text: `Please mention who you're asking about, e.g. \`where is @username?\``,
            });
            return;
        }

        const responses: string[] = [];
        for (const userId of mentionedUsers) {
            const statusText = await describeMemberStatus(userId);
            responses.push(statusText);
        }

        await say({
            thread_ts: event.ts,
            text: responses.join('\n'),
        });
        return;
    }

    await say({
        thread_ts: event.ts,
        text: `Hi <@${event.user}>, mention me with \`standup\` in a standup thread for summaries, or ask \"where is @username?\" to check OOO status.`,
    });
};
