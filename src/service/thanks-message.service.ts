import { CHANNEL_ID } from '../config';
import { format } from 'date-fns';
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


export const getThanksMessage = async (args: SlackEventMiddlewareArgs<'message'> & AllMiddlewareArgs) => {
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