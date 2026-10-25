import { App } from '@slack/bolt';
import { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN, SLACK_TEAM_ID } from '../config';
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

    instance.use(async ({ context, next }) => {
      if (context.teamId !== SLACK_TEAM_ID) {
        logger.warn('Ignoring Slack payload from an unconfigured workspace');
        return;
      }
      await next();
    });

    // Add error handler for Socket Mode connection issues
    instance.error(async (error) => {
      logger.error('🚨 Slack Bolt App Error:', error);
      // Don't re-throw - let the app continue
    });
  }
  return instance;
};
