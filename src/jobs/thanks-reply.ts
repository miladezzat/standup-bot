import { format } from 'date-fns';
import { CHANNEL_ID } from '../config';
import {slackApp} from '../singleton'
import { AllMiddlewareArgs, GenericMessageEvent, SlackEventMiddlewareArgs } from '@slack/bolt';

interface StandupUpdate {
  text: string;
  timestamp: string;
}

type UpdatesMap = Record<
  string, // thread_ts
  {
    date: string; // "yyyy-MM-dd"
    updatesByUser: Record<string, StandupUpdate[]>;
  }
>;

const standups: UpdatesMap = {};


slackApp.message(
    async (args: SlackEventMiddlewareArgs<'message'> & AllMiddlewareArgs) => {
        const { message, say } = args;
        const msg = message as GenericMessageEvent;

        if (
            msg.channel === CHANNEL_ID &&
            msg.user &&
            msg.thread_ts &&
            msg.thread_ts !== msg.ts
        ) {
            const dateKey = format(new Date(parseFloat(msg.thread_ts) * 1000), 'yyyy-MM-dd');

            if (!standups[msg.thread_ts]) {
                standups[msg.thread_ts] = {
                    date: dateKey,
                    updatesByUser: {},
                };
            }

            const thread = standups[msg.thread_ts];

            if (!thread.updatesByUser[msg.user]) {
                thread.updatesByUser[msg.user] = [];
            }

            thread.updatesByUser[msg.user].push({
                text: msg.text || '',
                timestamp: msg.ts,
            });

            await say({
                thread_ts: msg.thread_ts,
                text: `Thanks for the update, <@${msg.user}>!`,
            });
        }
    }
);

// Handle @app_mention with "standup" keyword
slackApp.event('app_mention', async ({ event, client, say }) => {
    const text = event.text?.toLowerCase() || '';
    const threadTs = event.thread_ts || event.ts;

    if (text.includes('standup')) {
        try {
            const result = await client.conversations.replies({
                channel: event.channel,
                ts: threadTs,
            });

            const replies = result.messages?.filter(m => m.ts !== threadTs);
            if (!replies || replies.length === 0) {
                await say({
                    thread_ts: threadTs,
                    text: `No standup updates found in this thread.`,
                });
                return;
            }

            const summary = replies
                .map(m => `• *<@${m.user}>*: ${m.text}`)
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
});