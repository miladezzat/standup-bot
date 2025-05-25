import type { AppMentionEvent, SayFn } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import standupThread from '../models/standupThread';

export const mentionApp = async ({
    event,
    client,
    say,
}: {
    event: AppMentionEvent;
    client: WebClient;
    say: SayFn;
}) => {
    const text = event.text?.toLowerCase() || '';
    const now = new Date();
    const queryDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const standupThreads = await standupThread.findOne({ date: queryDate }).sort({ date: -1 }).lean();

    const threadTs = standupThreads?.threadTs || event.thread_ts || event.ts;

    if (text.includes('standup')) {
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
    } else {
        await say({
            thread_ts: event.ts,
            text: `Hi <@${event.user}>, mention me with \`standup\` in a standup thread to get the summary!`,
        });
    }
};
