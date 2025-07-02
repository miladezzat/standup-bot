import dotenv from 'dotenv';
import { connectToDatabase } from './db/connection';
import { expressApp, slackApp } from './singleton';
import { runJobs } from './jobs';
import { getStandupHistory } from './service/standup-history.service';
import { mentionApp } from './service/app-mention.service';

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

// slackApp.message(getThanksMessage);

// Handle @app_mention with "standup" keyword
slackApp.event('app_mention', mentionApp);

expressApp.get('/', getStandupHistory);


expressApp.get('/health', (_, res) => res.send('OK'));

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
