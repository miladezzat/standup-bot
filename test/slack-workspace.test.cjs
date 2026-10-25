const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.SLACK_TEAM_ID = 'TTEAM';
const { stub } = require('./helpers.cjs');
let guard;
class FakeApp {
 use(middleware) { guard = middleware; }
 error() {}
}
const boltId = require.resolve('@slack/bolt');
require.cache[boltId] = { id: boltId, filename: boltId, loaded: true, exports: { App: FakeApp } };
const { getSlackApp } = require('../src/singleton/slack-app-singleton');
test('global Slack guard allows configured workspace and rejects unknown or foreign team before handlers', async () => {
 const app = getSlackApp();
 assert.equal(getSlackApp(), app);
 let calls = 0;
 for (const teamId of ['TOTHER', undefined, null, 'default']) await guard({ context: { teamId }, next: async () => { calls++; } });
 assert.equal(calls,0);
 await guard({ context: { teamId: 'TTEAM' }, next: async () => { calls++; } });
 assert.equal(calls,1);
});
