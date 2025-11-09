import dotenv from 'dotenv';

dotenv.config();

export const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
export const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;
export const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN!;
export const CHANNEL_ID = process.env.CHANNEL_ID!;

// Clerk configuration
export const CLERK_SIGN_IN_URL = process.env.CLERK_SIGN_IN_URL || 'https://adapted-buffalo-53.accounts.dev/sign-in';
