import { CronJob } from "cron";
import { slackApp } from '../singleton'
import { CHANNEL_ID } from "../config";
import { MESSAGE_BLOCKS } from "../constants";
import StandupThread from '../models/standupThread';
import { format } from "date-fns";

let currentStandupThreadTs: string | null = null;

export const standupReminder = new CronJob(
    '0 9 * * 0-4',
    async () => {
        try {
            const result = await slackApp.client.chat.postMessage({
                channel: CHANNEL_ID,
                text: `Good morning, team! :sunny:\n\nIt's time for our daily standup. Please reply in this thread with your updates:\n• What did you accomplish yesterday?\n• What are your plans for today?\n• Any blockers or challenges?`,
                blocks: MESSAGE_BLOCKS,
            });

            currentStandupThreadTs = result.ts || null;

            if (currentStandupThreadTs) {
                const dateKey = format(new Date(), 'yyyy-MM-dd');

                await StandupThread.findOneAndUpdate(
                    { date: dateKey },
                    {
                        date: dateKey,
                        threadTs: currentStandupThreadTs,
                        channelId: CHANNEL_ID,
                    },
                    { upsert: true, new: true }
                );
            }

            console.log('✅ Sent standup reminder');
        } catch (err) {
            console.error('❌ Error sending standup reminder:', err);
        }
    },
    null,
    true,
    'Africa/Cairo'
);