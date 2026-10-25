const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
process.env.SLACK_TEAM_ID = 'TTEAM';
process.env.CHANNEL_ID = 'CTEAM';
const { stub, query, matches, response } = require('./helpers.cjs');
stub('src/index.ts', { hasClerk: true });
stub('src/helper.ts', { getUserName: async id => ({ name: id, avatarUrl: '' }) });
const slackClient = { users: { info: async ({ user }) => ({ user: { id: user, name: user } }) }, conversations: { members: async () => ({ members: ['UALICE'] }), replies: async () => ({ messages: [] }) } };
stub('src/singleton/index.ts', { slackWebClient: slackClient, slackApp: { client: { chat: { postMessage: async () => {} } } } });
const Entry = require('../src/models/standupEntry').default;
const Metrics = require('../src/models/performanceMetrics').default;
const Achievement = require('../src/models/achievements').default;
const Alert = require('../src/models/alerts').default;
const Break = require('../src/models/break').default;
const Thread = require('../src/models/standupThread').default;
const exportsService = require('../src/service/export.service');
const { getSubmissionsDashboard } = require('../src/service/submissions-dashboard.service');
const { getUserReport } = require('../src/service/user-report.service');
const { getManagerDashboard } = require('../src/service/manager-dashboard.service');
const { getTeamAnalyticsDashboard } = require('../src/service/team-analytics-dashboard.service');
const { getBreaksDashboard } = require('../src/service/breaks-dashboard.service');
const { serveWorkflowDashboard } = require('../src/service/workflow.service');
const { getTeamMembersWhoHaventSubmitted } = require('../src/service/team-members.service');
const { getStandupHistory } = require('../src/service/standup-history.service');
const { getUserContributions, getUserStreak } = require('../src/service/contribution-graph.service');
const base = { _id: 'record', workspaceId: 'TTEAM', slackUserId: 'UALICE', slackUserName: 'Alice', date: '2026-10-20', yesterday: '- Shipped BOT-123\n- Reviewed code', today: '- Plan\n- Plan\n- Plan', blockers: '', notes: '', isDayOff: false, yesterdayHoursEstimate: 7, todayHoursEstimate: 8, createdAt: new Date('2026-10-20T09:00:00Z'), period: 'week', startDate: '2026-10-18', endDate: '2026-10-20', overallScore: 80, isActive: true, badgeName: 'Local badge', level: 'gold', earnedAt: new Date('2026-10-20T09:00:00Z'), description: '', suggestedActions: [], affectedUserId: 'UALICE', affectedUserName: 'Alice', status: 'active', title: 'Local alert', durationMinutes: 20, startTime: '13:00', endTime: '13:20' };
function models(rows = [base, { ...base, workspaceId: 'TOTHER', slackUserName: 'FOREIGN_SECRET', badgeName: 'FOREIGN_SECRET', title: 'FOREIGN_SECRET', yesterday: 'FOREIGN_SECRET', overallScore: 1, yesterdayHoursEstimate: 200 }]) {
 const calls = [];
 for (const model of [Entry, Metrics, Achievement, Alert, Break]) {
  for (const method of ['find','findOne']) mock.method(model, method, filter => { calls.push({model: model.modelName, filter}); assert.equal(filter.workspaceId, 'TTEAM'); return query(rows, filter, method === 'findOne'); });
  mock.method(model, 'distinct', async (field, filter) => { calls.push({model: model.modelName, filter}); assert.equal(filter.workspaceId, 'TTEAM'); return [...new Set(rows.filter(row => matches(row,filter)).map(row => row[field]))]; });
 }
 return calls;
}
afterEach(() => { mock.restoreAll(); mock.timers.reset(); });
function freeze() { mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T16:00:00Z') }); }
const req = () => ({ query: { date: '2026-10-20', period: 'week', workspaceId: 'TOTHER' }, params: { userId: 'UALICE' } });

test('every CSV reader excludes foreign workspace records including all comprehensive report sections', async () => {
 freeze(); models();
 for (const handler of Object.values(exportsService)) {
  const res = response();
  await handler(req(),res);
  assert.equal(res.statusCode, 200, handler.name);
  assert.ok(!res.data.includes('FOREIGN_SECRET'), handler.name);
 }
});

test('dashboards and nested report helpers isolate the configured workspace and use completed totals', async () => {
 freeze(); const calls = models();
 for (const handler of [getSubmissionsDashboard,getUserReport,getManagerDashboard,getTeamAnalyticsDashboard,getBreaksDashboard,serveWorkflowDashboard]) {
  const res = response();
  await handler(req(),res);
  assert.equal(res.statusCode, 200, handler.name);
  assert.ok(!JSON.stringify(res.data).includes('FOREIGN_SECRET'), handler.name);
  if (handler === getUserReport) assert.equal(res.data.totalTasks, 2);
  if (handler === getTeamAnalyticsDashboard) {
   assert.equal(res.data.totalHours, 7);
   assert.equal(res.data.velocityData.find(d => d.date === '10/20').tasks, 2);
  }
 }
 assert.ok(calls.length >= 15);
});

test('foreign submissions do not suppress reminders or count in contribution/streak helpers', async () => {
 freeze(); models([{ ...base, workspaceId: 'TOTHER' }]);
 assert.equal((await getTeamMembersWhoHaventSubmitted()).length, 1);
 const graph = await getUserContributions('UALICE', 7);
 assert.ok(graph.every(day => !day.hasSubmission && day.estimatedHours === 0));
 assert.equal((await getUserStreak('UALICE')).total, 0);
});

test('legacy history uses configured channel, including all-history query', async () => {
 freeze();
 const filters = [];
 mock.method(Thread,'find', filter => { filters.push(filter); return query([],filter); });
 for (const date of ['2026-10-20', undefined]) await getStandupHistory({ query: { date } }, response());
 assert.equal(filters.length,2);
 assert.ok(filters.every(f => f.channelId === 'CTEAM'));
});

test('scheduled future leave does not inflate current analytics, active roster or streak totals', async()=>{
 freeze(); models([base,{...base,date:'2026-12-01',slackUserId:'UFUTURE',slackUserName:'Future member',isDayOff:true}]);
 const analytics=response(); await getTeamAnalyticsDashboard(req(),analytics);
 assert.equal(analytics.data.totalSubmissions,1);
 assert.equal(analytics.data.totalUsers,1);
 const manager=response(); await getManagerDashboard(req(),manager);
 assert.equal(manager.data.teamSize,1);
 assert.equal((await getUserStreak('UFUTURE')).total,0);
});

test('workflow excludes empty placeholders and full-day leave from completed/planned task counts',async()=>{
 freeze(); models([{...base,yesterday:'None',today:'N/A',blockers:'No blockers'}, {...base,slackUserId:'UBOB',isDayOff:true,yesterday:'Day off',today:'Day off'}]);
 const res=response(); await serveWorkflowDashboard(req(),res);
 assert.equal(res.statusCode,200);
 assert.equal(res.data.completedTasks,0);
 assert.equal(res.data.plannedTasks,0);
 assert.equal(res.data.blockerCount,0);
});

test('blocker heatmap preserves member names when all submissions are leave',async()=>{
 freeze(); models([{...base,isDayOff:true,blockers:'Vacation'}]);
 const res=response(); await getTeamAnalyticsDashboard(req(),res);
 assert.equal(res.data.blockerHeatmap[0].userName,'Alice');
 assert.equal(res.data.blockerHeatmap[0].totalDays,0);
 assert.equal(res.data.blockerHeatmap[0].blockerRate,0);
});
