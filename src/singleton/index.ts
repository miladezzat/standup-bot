import { getSlackApp } from './slack-app-singleton';
import { getSlackWebClient } from './slack-web-client-singleton';
import { getExpressApp } from './express-app-singleton';

export const slackApp = getSlackApp();
export const slackWebClient = getSlackWebClient();
export const expressApp = getExpressApp();
