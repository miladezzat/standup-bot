import { WebClient } from '@slack/web-api';
import { SLACK_BOT_TOKEN } from '../config';

let instance: WebClient | null = null;

export const getSlackWebClient = (): WebClient => {
  if (!instance) {
    instance = new WebClient(SLACK_BOT_TOKEN);
  }
  return instance;
};
