import { App } from '@slack/bolt';
import { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN } from '../config';

let instance: App | null = null;

export const getSlackApp = (): App => {
  if (!instance) {
    instance = new App({
      token: SLACK_BOT_TOKEN,
      signingSecret: SLACK_SIGNING_SECRET,
      socketMode: true,
      appToken: SLACK_APP_TOKEN,
    });
  }
  return instance;
};
