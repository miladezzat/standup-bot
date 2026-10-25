const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.SLACK_TEAM_ID = 'TTEAM';
const { stub, response } = require('./helpers.cjs');
let account;
const getUser = mock.fn(async () => account);
stub('node_modules/@clerk/express/dist/index.js', { clerkClient: { users: { getUser } }, requireAuth: () => () => {}, getAuth: req => req.auth() });
// Isolate the route boundary from Slack/network/database work. Every handler is
// a sentinel; a denied request must never reach one of these data readers.
const serviceExports = {
 'standup-history': ['getStandupHistory'], 'submissions-dashboard': ['getSubmissionsDashboard'],
 'user-report': ['getUserReport'], 'manager-dashboard': ['getManagerDashboard'],
 'team-analytics-dashboard': ['getTeamAnalyticsDashboard'], 'breaks-dashboard': ['getBreaksDashboard'],
 'workflow': ['serveWorkflowDashboard'], 'linear-notes': ['serveLinearNotes'],
 'export': ['exportStandupsCSV','exportPerformanceMetricsCSV','exportAlertsCSV','exportAchievementsCSV','exportUserReportCSV'],
};
for (const [file, names] of Object.entries(serviceExports)) {
 stub(`src/service/${file}.service.ts`, Object.fromEntries(names.map(name => [name, (_req, res) => res.send(name)])));
}
const { registerDashboardRoutes } = require('../src/routes/dashboard.routes');
const { parseDashboardAccess } = require('../src/middleware/clerk-auth.middleware');
const membership = (role = 'member', workspaceId = 'TTEAM') => ({ privateMetadata: { standup: { workspaceId, slackUserId: 'UALICE', role } } });
function routes(auth = true) {
 const result = new Map();
 registerDashboardRoutes({ get(path, ...handlers) { result.set(path, handlers); } }, auth);
 return result;
}
async function request(path, { userId = 'clerk_alice', params = {}, query = {}, authenticated = true, publicMode = false } = {}) {
 const req = { params, query, originalUrl: path, path, auth: () => ({ userId: authenticated ? userId : null }) };
 const res = response();
 const handlers = routes(!publicMode).get(path);
 assert.ok(handlers, `Route registered: ${path}`);
 let i = 0;
 // Express next() is synchronous; collect asynchronous middleware completion.
 let pending = [];
 function run() { const handler = handlers[i++]; if (handler) pending.push(Promise.resolve(handler(req, res, run))); }
 run();
 while (pending.length) await pending.shift();
 return res;
}

test('unauthenticated requests redirect with encoded return URL', async () => {
 const res = await request('/manager', { authenticated: false });
 assert.equal(res.statusCode, 302);
 assert.equal(res.location, '/auth/sign-in?redirect_url=%2Fmanager');
});

test('unprovisioned, malformed and other-workspace Clerk users cannot reach any data route', async () => {
 for (account of [{ privateMetadata: {} }, membership('manager','TOTHER'), membership('admin'), { privateMetadata: { standup: 'manager' } }]) {
  for (const path of routes().keys()) {
   const res = await request(path, { params: { userId: 'UALICE' }, query: { workspaceId: 'TTEAM', role: 'manager' } });
   assert.equal(res.statusCode, 403, path);
  }
 }
});

test('members can view team standups and their own Slack report, not other users or managers data', async () => {
 account = membership();
 for (const path of ['/', '/submissions', '/history', '/workflow', '/breaks', '/linear-notes']) {
  assert.equal((await request(path)).statusCode, 200, path);
 }
 assert.equal((await request('/user/:userId', { params: { userId: 'UALICE' } })).data, 'getUserReport');
 for (const userId of ['UBOB', 'clerk_alice', ['UALICE'], { $ne: '' }]) {
  assert.equal((await request('/user/:userId', { params: { userId } })).statusCode, 403);
 }
 for (const path of ['/manager','/analytics', ...[...routes().keys()].filter(p => p.startsWith('/export/'))]) {
  assert.equal((await request(path, { params: { userId: 'UALICE' }, query: { role: 'manager' } })).statusCode, 403, path);
 }
});

test('provisioned managers can access all registered data routes and another member report', async () => {
 account = membership('manager');
 for (const path of routes().keys()) assert.equal((await request(path, { params: { userId: 'UBOB' } })).statusCode, 200, path);
});

test('server lookup errors fail closed and query/user-editable metadata never grants access', async () => {
 account = { privateMetadata: {}, publicMetadata: membership('manager').privateMetadata, unsafeMetadata: membership('manager').privateMetadata };
 assert.equal((await request('/manager', { query: { standup: membership('manager').privateMetadata.standup } })).statusCode, 403);
 account = membership();
 getUser.mock.mockImplementationOnce(async () => { throw new Error('Clerk unavailable'); });
 assert.equal((await request('/manager')).statusCode, 302);
});

test('explicit no-Clerk public mode retains access to all registered dashboards and exports', async () => {
 for (const path of routes(false).keys()) assert.equal((await request(path, { publicMode: true, authenticated: false })).statusCode, 200, path);
});

test('membership parser rejects missing, unknown and malformed identities', () => {
 for (const standup of [null, {}, [], { workspaceId: 'TTEAM', slackUserId: '', role: 'member' },
   { workspaceId: 'TTEAM', slackUserId: { $ne: '' }, role: 'manager' },
   { workspaceId: 'TTEAM', slackUserId: 'UALICE', role: ['manager'] }]) {
  assert.equal(parseDashboardAccess({ standup }), null);
 }
});
