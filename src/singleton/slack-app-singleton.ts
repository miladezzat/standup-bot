import { App } from '@slack/bolt';
import { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN } from '../config';
import { logger } from '../utils/logger';

let instance: App | null = null;

export const getSlackApp = (): App => {
  if (!instance) {
    instance = new App({
      token: SLACK_BOT_TOKEN,
      signingSecret: SLACK_SIGNING_SECRET,
      socketMode: true,
      appToken: SLACK_APP_TOKEN,
    });

    // Add error handler for Socket Mode connection issues
    instance.error(async (error) => {
      logger.error('🚨 Slack Bolt App Error:', error);
      // Don't re-throw - let the app continue
    });
  }
  return instance;
};
