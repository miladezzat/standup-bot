import { CronJob } from "cron";
import { slackApp } from '../singleton'
import { CHANNEL_ID } from "../config";
import StandupThread from '../models/standupThread';
import { format } from "date-fns";

let currentStandupThreadTs: string | null = null;

export const standupReminder = new CronJob(
    process.env.DAILY_REMINDER_CRON || '0 9 * * 0-4', // Default: 9 AM Sun-Thu
    async () => {
        try {
            const result = await slackApp.client.chat.postMessage({
                channel: CHANNEL_ID,
                text: `Good morning, team! :sunny:\n\nIt's time for our daily standup. Please submit your standup using the /standup command.`,
                blocks: [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: ":wave: *Good morning, team!*\n\nIt's time for our daily standup."
                        }
                    },
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: "Please submit your standup by typing `/standup` in any channel or DM with the bot."
                        }
                    },
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: "You'll be asked to share:\n• *What did you accomplish yesterday?*\n• *What are your plans for today?*\n• *Any blockers or challenges?*\n• *Any notes or context for the team?*"
                        }
                    },
                    {
                        type: "context",
                        elements: [
                            {
                                type: "mrkdwn",
                                text: "Thank you for keeping us all aligned! :rocket:"
                            }
                        ]
                    }
                ]
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
