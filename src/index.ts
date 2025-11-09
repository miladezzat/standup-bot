import dotenv from 'dotenv';
dotenv.config(); // Load env first!

import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { clerkMiddleware } from '@clerk/express';
import { connectToDatabase } from './db/connection';
import { expressApp, slackApp } from './singleton';
import { runJobs } from './jobs';
import { getStandupHistory } from './service/standup-history.service';
import { mentionApp } from './service/app-mention.service';
import { openStandupModal, handleStandupSubmission } from './service/standup-submission.service';
import { getSubmissionsDashboard } from './service/submissions-dashboard.service';
import { getUserReport } from './service/user-report.service';
import { getDailySummaryView } from './service/daily-summary-view.service';
import { apiLimiter } from './middleware/security.middleware';
import { checkAuth } from './middleware/clerk-auth.middleware';
import { logger, logInfo, logError } from './utils/logger';

// ============================================
// 🔒 SECURITY MIDDLEWARE
// ============================================

// Helmet - Security headers
expressApp.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
            fontSrc: ["'self'", 'fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'https:'],
            scriptSrc: ["'self'", "'unsafe-inline'"], // Needed for Clerk
            connectSrc: ["'self'", 'https://clerk.com', 'https://*.clerk.accounts.dev'],
        },
    },
}));

// Cookie parser for Clerk sessions
expressApp.use(cookieParser());

// Clerk authentication middleware
expressApp.use(clerkMiddleware());

// Rate limiting on dashboard routes
expressApp.use(apiLimiter);

// ============================================
// 🔐 ENVIRONMENT VALIDATION
// ============================================

export const requiredEnvVars = [
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_APP_TOKEN',
    'CHANNEL_ID',
];

// Clerk is optional - if provided, authentication is enabled
// Check if keys are real (not just placeholders)
const hasValidClerkKeys = 
    process.env.CLERK_PUBLISHABLE_KEY && 
    process.env.CLERK_SECRET_KEY &&
    process.env.CLERK_PUBLISHABLE_KEY.startsWith('pk_') &&
    process.env.CLERK_SECRET_KEY.startsWith('sk_') &&
    process.env.CLERK_PUBLISHABLE_KEY.length > 20 &&
    process.env.CLERK_SECRET_KEY.length > 20;

export const hasClerk = hasValidClerkKeys;

if (hasClerk) {
    logInfo('🔐 Clerk authentication enabled');
    console.log('\n✅ Clerk Authentication Active');
} else {
    logError('⚠️ WARNING: Clerk not configured - dashboards are PUBLIC!');
    console.log('\n⚠️  SECURITY WARNING ⚠️');
    console.log('Clerk authentication is not configured.');
    console.log('Your dashboards are publicly accessible!');
    console.log('\nTo enable authentication:');
    console.log('1. Create account at https://clerk.com');
    console.log('2. Add to .env:');
    console.log('   CLERK_PUBLISHABLE_KEY=pk_...');
    console.log('   CLERK_SECRET_KEY=sk_...\n');
}

for (const key of requiredEnvVars) {
    if (!process.env[key]) {
        logError(`Missing required environment variable: ${key}`);
        throw new Error(`Missing required environment variable: ${key}`);
    }
}

logInfo('✅ Environment variables validated');

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

// ============================================
// 🌐 WEB ROUTES
// ============================================

// Public health check (no auth required)
expressApp.get('/health', (_, res) => {
    logger.info('Health check');
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Auth sign-out (logout)
expressApp.get('/auth/sign-out', async (req, res) => {
    if (hasClerk) {
        try {
            // Sign out through Clerk API
            logger.info('User signing out via Clerk API');
            
            // Get auth object from Clerk middleware
            const auth = (req as any).auth();
            
            if (auth && auth.sessionId) {
                // Import Clerk client to revoke session
                const { clerkClient } = await import('@clerk/express');
                
                try {
                    // Revoke the session on Clerk's side
                    await clerkClient.sessions.revokeSession(auth.sessionId);
                    logger.info(`Session ${auth.sessionId} revoked successfully`);
                } catch (revokeError) {
                    logger.error('Error revoking session:', revokeError);
                }
            }
            
            // Clear Clerk session cookies
            res.clearCookie('__session');
            res.clearCookie('__clerk_db_jwt');
            
            // Show success page with redirect
            res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Signed Out</title>
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body {
                            font-family: 'Inter', Arial, sans-serif;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            min-height: 100vh;
                            padding: 1rem;
                        }
                        .container {
                            background: white;
                            padding: 3rem;
                            border-radius: 16px;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                            max-width: 500px;
                            width: 100%;
                            text-align: center;
                            animation: fadeIn 0.4s ease;
                        }
                        @keyframes fadeIn {
                            from { opacity: 0; transform: translateY(20px); }
                            to { opacity: 1; transform: translateY(0); }
                        }
                        .icon { font-size: 4rem; margin-bottom: 1rem; }
                        h1 { color: #27ae60; margin-bottom: 0.5rem; font-size: 2rem; }
                        p { color: #7f8c8d; line-height: 1.6; margin-bottom: 1rem; font-size: 1.1rem; }
                        .redirect-msg { color: #95a5a6; font-size: 0.9rem; margin-top: 1rem; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="icon">👋</div>
                        <h1>Signed Out Successfully</h1>
                        <p>You've been signed out. See you next time!</p>
                        <p class="redirect-msg">Redirecting to dashboard...</p>
                    </div>
                    <script>
                        setTimeout(() => { window.location.href = '/'; }, 2000);
                    </script>
                </body>
                </html>
            `);
        } catch (error) {
            logger.error('Error during sign out:', error);
            // Even if there's an error, redirect to home
            res.redirect('/');
        }
    } else {
        // If Clerk not configured, user menu shouldn't be visible anyway
        logger.info('Sign-out accessed but Clerk not configured');
        res.redirect('/');
    }
});

// Auth sign-in page (Clerk) - Redirect to Clerk hosted page
expressApp.get('/auth/sign-in', (req, res) => {
    if (!hasClerk) {
        res.send(`
            <html>
                <head>
                    <title>Authentication Required</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            min-height: 100vh;
                            margin: 0;
                        }
                        .container {
                            background: white;
                            padding: 3rem;
                            border-radius: 16px;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                            max-width: 500px;
                            text-align: center;
                        }
                        h1 { color: #e74c3c; margin-bottom: 1rem; }
                        p { color: #7f8c8d; line-height: 1.6; }
                        code {
                            background: #f5f5f5;
                            padding: 0.2rem 0.5rem;
                            border-radius: 4px;
                            font-family: monospace;
                        }
                        .warning { background: #fff3cd; padding: 1rem; border-radius: 8px; margin-top: 1rem; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>⚠️ Authentication Not Configured</h1>
                        <p>Clerk authentication is not set up. Please add your API keys to the <code>.env</code> file:</p>
                        <div class="warning">
                            <p><strong>Required in .env:</strong></p>
                            <code>CLERK_PUBLISHABLE_KEY=pk_...</code><br>
                            <code>CLERK_SECRET_KEY=sk_...</code>
                        </div>
                        <p style="margin-top: 1.5rem; font-size: 0.9rem; color: #95a5a6;">
                            See <strong>AUTHENTICATION_SETUP.md</strong> for detailed instructions
                        </p>
                    </div>
                </body>
            </html>
        `);
        return;
    }
    
    logger.info('Redirecting to Clerk sign-in');
    
    // Redirect to Clerk's hosted sign-in page
    // Use the redirect_url from query params, or default to /submissions
    const returnPath = req.query.redirect_url as string || '/submissions';
    const redirectUrl = encodeURIComponent(`${req.protocol}://${req.get('host')}${returnPath}`);
    res.redirect(`https://adapted-buffalo-53.accounts.dev/sign-in?redirect_url=${redirectUrl}`);
});

// Protected dashboard routes (require auth if Clerk is configured)
const authMiddleware = hasClerk ? checkAuth : (req: any, res: any, next: any) => next();

expressApp.get('/', authMiddleware, getSubmissionsDashboard);
expressApp.get('/submissions', authMiddleware, getSubmissionsDashboard);
expressApp.get('/user/:userId', authMiddleware, getUserReport); // Individual user report
expressApp.get('/daily-summary', authMiddleware, getDailySummaryView); // AI-powered daily summary view
expressApp.get('/history', authMiddleware, getStandupHistory); // Legacy thread-based view

// ============================================
// 🧪 TEST ENDPOINTS (Remove in production)
// ============================================

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

// ============================================
// 🚀 START APPLICATION
// ============================================

(async () => {
    try {
        logInfo('🚀 Starting Standup Bot...');
        
        await connectToDatabase();
        logInfo('✅ MongoDB connected');
        
        await slackApp.start();
        logInfo('✅ Slack bot started in Socket Mode');
        
        await runJobs();
        logInfo('✅ Cron jobs scheduled');
        
        await expressApp.listen(PORT, () => {
            logInfo(`🌐 Express server running on http://localhost:${PORT}`);
            
            if (!hasClerk) {
                console.log('\n⚠️  Dashboards are PUBLIC - anyone can access!');
                console.log(`   Dashboard: http://localhost:${PORT}`);
            } else {
                console.log(`\n🔐 Authentication enabled via Clerk`);
                console.log(`   Dashboard: http://localhost:${PORT}`);
                console.log(`   Sign in: http://localhost:${PORT}/auth/sign-in`);
            }
            
            console.log(`\n✅ Standup Bot ready!\n`);
        });
    } catch (error) {
        logError('❌ Startup error', error);
        console.error('Startup error:', error);
        process.exit(1);
    }
})();
