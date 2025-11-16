import dotenv from 'dotenv';

dotenv.config();

export const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
export const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;
export const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN!;
export const CHANNEL_ID = process.env.CHANNEL_ID!;

// Global configuration options
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Africa/Cairo';
export const ENABLE_TEST_ROUTES = process.env.ENABLE_TEST_ROUTES === 'true';
export const ALLOW_PUBLIC_DASHBOARD = process.env.ALLOW_PUBLIC_DASHBOARD === 'true';

// Clerk configuration
export const CLERK_SIGN_IN_URL = process.env.CLERK_SIGN_IN_URL || 'https://adapted-buffalo-53.accounts.dev/sign-in';
