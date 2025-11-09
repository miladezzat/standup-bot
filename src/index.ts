import dotenv from 'dotenv';
import { connectToDatabase } from './db/connection';
import { expressApp, slackApp } from './singleton';
import { runJobs } from './jobs';
import { getStandupHistory } from './service/standup-history.service';
import { mentionApp } from './service/app-mention.service';
import { openStandupModal, handleStandupSubmission } from './service/standup-submission.service';
import { getSubmissionsDashboard } from './service/submissions-dashboard.service';
import { getUserReport } from './service/user-report.service';

dotenv.config();

export const requiredEnvVars = [
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_APP_TOKEN',
    'CHANNEL_ID',
];

for (const key of requiredEnvVars) {
    if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
}

// Handle /standup slash command
slackApp.command('/standup', openStandupModal);

// Handle button click from reminder message
slackApp.action('open_standup_modal', async ({ ack, body, client }) => {
    await ack();
    await openStandupModal({ client, body });
});

// Handle standup modal submission
slackApp.view('standup_submission', handleStandupSubmission);

// Handle @app_mention with "standup" keyword
slackApp.event('app_mention', mentionApp);

// Web routes
expressApp.get('/', getSubmissionsDashboard);
expressApp.get('/submissions', getSubmissionsDashboard);
expressApp.get('/user/:userId', getUserReport); // Individual user report
expressApp.get('/history', getStandupHistory); // Legacy thread-based view
expressApp.get('/health', (_, res) => res.send('OK'));

// Test trigger - Send standup reminder now
expressApp.get('/trigger/standup-reminder', async (_, res) => {
    try {
        await slackApp.client.chat.postMessage({
            channel: process.env.CHANNEL_ID!,
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
                        text: "You'll be asked to share:\n• *What did you accomplish yesterday?*\n• *What are your plans for today?*\n• *Any blockers or challenges?*"
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
        res.send(`✅ <b>Standup reminder sent successfully!</b><br><br>Check your Slack channel now.<br><br><a href="/submissions">View Submissions Dashboard</a>`);
    } catch (error) {
        console.error('Error sending test reminder:', error);
        res.status(500).send(`❌ Error: ${error}`);
    }
});

// Test trigger - Generate daily summary now
expressApp.get('/trigger/daily-summary', async (req, res) => {
    try {
        const { postDailySummaryToSlack } = await import('./service/ai-summary.service');
        const { format } = await import('date-fns');
        const { toZonedTime } = await import('date-fns-tz');
        
        const dateParam = req.query.date as string;
        const date = dateParam || format(toZonedTime(new Date(), 'Africa/Cairo'), 'yyyy-MM-dd');
        
        await postDailySummaryToSlack(date);
        res.send(`✅ <b>Daily summary generated for ${date}!</b><br><br>Check your Slack channel now.<br><br><a href="/submissions">View Dashboard</a>`);
    } catch (error) {
        console.error('Error triggering daily summary:', error);
        res.status(500).send(`❌ Error: ${error}`);
    }
});

const PORT = Number(process.env.PORT) || 3001;

(async () => {
    try {
        await connectToDatabase();
        console.log('⚡️ Slack bot started in Socket Mode');
        await slackApp.start();
        await runJobs();
        await expressApp.listen(PORT, () => {
            console.log(`🌐 Express UI running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Startup error:', error);
        process.exit(1); // Optional: graceful shutdown
    }
})();
