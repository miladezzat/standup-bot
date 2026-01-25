import dotenv from 'dotenv';

dotenv.config();

// Slack configuration
export const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
export const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;
export const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN!;
export const CHANNEL_ID = process.env.CHANNEL_ID!;
export const SLACK_TEAM_ID = process.env.SLACK_TEAM_ID || 'default';

// Global configuration options
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Africa/Cairo';
export const ENABLE_TEST_ROUTES = process.env.ENABLE_TEST_ROUTES === 'true';
export const ALLOW_PUBLIC_DASHBOARD = process.env.ALLOW_PUBLIC_DASHBOARD === 'true';
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';

// Clerk configuration
export const CLERK_SIGN_IN_URL = process.env.CLERK_SIGN_IN_URL || 'https://adapted-buffalo-53.accounts.dev/sign-in';

// Rate limiting configuration
export const API_RATE_LIMIT_WINDOW_MS = parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '900000', 10);
export const API_RATE_LIMIT_MAX = parseInt(process.env.API_RATE_LIMIT_MAX || '100', 10);

// Break configuration
export const MAX_BREAK_DURATION_MINUTES = parseInt(process.env.MAX_BREAK_DURATION_MINUTES || '480', 10);
export const BREAK_WARNING_THRESHOLD_MINUTES = parseInt(process.env.BREAK_WARNING_THRESHOLD_MINUTES || '120', 10);

// Linear configuration
export const LINEAR_API_KEY = process.env.LINEAR_API_KEY || '';
