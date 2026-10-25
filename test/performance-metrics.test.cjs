const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
process.env.SLACK_TEAM_ID = 'TTEAM';
process.env.APP_TIMEZONE = 'Africa/Cairo';
const { query } = require('./helpers.cjs');
const Entry = require('../src/models/standupEntry').default;
const Metrics = require('../src/models/performanceMetrics').default;
const { calculatePerformanceMetrics, assessRiskLevel, calculateVelocityTrend, detectRecurringBlockers, calculateTeamMetrics } = require('../src/service/performance-analysis.service');
const { completedTasks, countReportedTasks, reportedHours, submissionRate, workingDates, hasBlockers } = require('../src/utils/standup-metrics');
afterEach(() => { mock.restoreAll(); mock.timers.reset(); });
const entry = (date, extra = {}) => ({ workspaceId: 'TTEAM', slackUserId: 'UALICE', slackUserName: 'Alice',
  date, yesterday: '- Fixed BOT-123\n- Reviewed https://example.com/a-b', today: '- Plan one\n- Plan two\n- Plan three',
  blockers: 'None', createdAt: new Date(`${date}T09:00:00Z`), yesterdayHoursEstimate: 7, todayHoursEstimate: 8, ...extra });
function useRows(rows) {
  const filters = [];
  mock.method(Entry, 'find', filter => { filters.push(filter); return query(rows, filter); });
  mock.method(Entry, 'findOne', filter => query(rows, filter, true));
  return filters;
}

test('completed tasks count lines, not plans, issue-ID hyphens, URLs, empty placeholders or leave', () => {
  assert.equal(completedTasks(entry('2026-10-19')), 2);
  assert.equal(countReportedTasks('Shipped BOT-123 at https://a/b-c'), 1);
  assert.equal(countReportedTasks('1. First\n2) Second\n• Third\n* Fourth'), 4);
  for (const text of ['', '  ', 'None', 'N/A', 'No tasks', 'Day off']) assert.equal(countReportedTasks(text), 0);
  assert.equal(completedTasks(entry('2026-10-19', { isDayOff: true })), 0);
  assert.equal(completedTasks(entry('2026-10-19', { isDayOff: true, dayOffStartTime: '13:00', dayOffEndTime: '14:00' })), 2);
});

test('reported hours ignore planned, missing, negative and non-finite estimates', () => {
  assert.equal(reportedHours(entry('2026-10-19')), 7);
  for (const hours of [undefined, 0, -4, NaN, Infinity]) assert.equal(reportedHours(entry('2026-10-19', { yesterdayHoursEstimate: hours })), 0);
});

test('calendar handles Sun–Thu, full-day leave, duplicate dates and empty intervals', () => {
  assert.deepEqual(workingDates('2026-10-18', '2026-10-24'), ['2026-10-18','2026-10-19','2026-10-20','2026-10-21','2026-10-22']);
  const rows = [entry('2026-10-18'), entry('2026-10-18'), entry('2026-10-19', { isDayOff: true }), entry('2026-10-23')];
  assert.deepEqual(submissionRate(rows, '2026-10-18', '2026-10-20'), { expected: 2, count: 1, rate: 0.5 });
  assert.deepEqual(submissionRate([], '2026-10-24', '2026-10-23'), { expected: 0, count: 0, rate: 1 });
});

test('weekly metrics use elapsed days, actual work, configured timezone and only the requested workspace', async () => {
  const rows = [entry('2026-10-18'), entry('2026-10-19', { isDayOff: true }), entry('2026-10-20'),
    entry('2026-10-21'), entry('2026-10-20', { workspaceId: 'TOTHER', yesterday: '- Leak\n- Leak\n- Leak', yesterdayHoursEstimate: 100 })];
  const filters = useRows(rows);
  const result = await calculatePerformanceMetrics('UALICE', 'week', 'TTEAM', new Date('2026-10-20T16:00:00Z'));
  assert.equal(result.startDate, '2026-10-18');
  assert.equal(result.endDate, '2026-10-20');
  assert.equal(result.expectedSubmissions, 2);
  assert.equal(result.consistencyScore, 100);
  assert.equal(result.totalSubmissions, 2);
  assert.equal(result.totalTasksCompleted, 4);
  assert.equal(result.totalHoursEstimated, 14);
  assert.equal(result.blockerCount, 0);
  assert.equal(result.averageSubmissionTime, '12:00');
  assert.equal(result.lateSubmissions, 0);
  assert.ok(filters.every(f => f.workspaceId === 'TTEAM' && f.date.$lte === '2026-10-20'));
});

test('month and quarter start at calendar boundaries and cap consistency even with weekend work', async () => {
  useRows([entry('2026-10-01'), entry('2026-10-02'), entry('2026-10-03')]);
  for (const period of ['month', 'quarter']) {
    const result = await calculatePerformanceMetrics('UALICE', period, 'TTEAM', new Date('2026-10-03T16:00:00Z'));
    assert.equal(result.startDate, '2026-10-01');
    assert.equal(result.expectedSubmissions, 1);
    assert.equal(result.consistencyScore, 100);
  }
});

test('all leave and no records produce finite results or null', async () => {
  useRows([entry('2026-10-18', { isDayOff: true, blockers: 'Vacation' })]);
  const result = await calculatePerformanceMetrics('UALICE', 'week', 'TTEAM', new Date('2026-10-18T16:00:00Z'));
  assert.equal(result.totalTasksCompleted, 0);
  assert.equal(result.blockerFrequency, 0);
  assert.equal(result.expectedSubmissions, 0);
  assert.ok(Number.isFinite(result.overallScore));
  assert.equal(await calculatePerformanceMetrics('UNOBODY', 'week', 'TTEAM'), null);
});

test('risk detects a real drop across date windows, including no recent submissions', async () => {
  const rows = workingDates('2026-10-04', '2026-10-10').map(date => entry(date));
  useRows([...rows, entry('2026-10-14', { workspaceId: 'TOTHER', yesterdayHoursEstimate: 200 }), entry('2026-10-30')]);
  const risk = await assessRiskLevel('UALICE', 14, 'TTEAM', new Date('2026-10-17T16:00:00Z'));
  assert.ok(risk.factors.includes('Declining submission frequency'));
  assert.ok(!risk.factors.some(f => f.includes('High workload')));
});

test('steady working-day attendance is not penalized for weekends or planned hours', async () => {
  useRows(workingDates('2026-10-04', '2026-10-17').map(date => entry(date, { yesterdayHoursEstimate: 8, todayHoursEstimate: 24 })));
  const risk = await assessRiskLevel('UALICE', 14, 'TTEAM', new Date('2026-10-17T16:00:00Z'));
  assert.deepEqual(risk, { level: 'low', score: 0, factors: [] });
});

test('velocity sorts dates and uses completed work, independent of plans and input ordering', () => {
  const rows = Array.from({length: 10}, (_, i) => entry(`2026-10-${String(i + 1).padStart(2,'0')}`, { yesterday: i < 5 ? '- One' : '- One\n- Two', today: i < 5 ? '- a\n- b\n- c\n- d' : 'None' }));
  assert.equal(calculateVelocityTrend(rows), 'increasing');
  assert.equal(calculateVelocityTrend([...rows].reverse()), 'increasing');
});

test('blocker placeholders are ignored and repeated words count once per day', () => {
  for (const blockers of ['None', 'n/a', 'No', 'No blockers.', '']) assert.equal(hasBlockers(entry('2026-10-19', { blockers })), false);
  assert.equal(hasBlockers(entry('2026-10-19', { blockers: 'None of the API requests succeed' })), true);
  assert.deepEqual(detectRecurringBlockers([entry('2026-10-19', { blockers: 'database database database' })]), []);
  assert.deepEqual(detectRecurringBlockers([18,19,20].map(d => entry(`2026-10-${d}`, { blockers: 'database' }))), ['database']);
});

test('team metric upserts include workspace identity', async () => {
  const today = require('date-fns').format(require('date-fns-tz').toZonedTime(new Date(), 'Africa/Cairo'), 'yyyy-MM-dd');
  useRows([entry(today)]);
  mock.method(Entry, 'distinct', async (_field, filter) => { assert.equal(filter.workspaceId, 'TTEAM'); return ['UALICE']; });
  const writes = [];
  mock.method(Metrics, 'findOneAndUpdate', async (filter, data) => { writes.push({filter, data}); });
  await calculateTeamMetrics('TTEAM', 'week');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filter.workspaceId, 'TTEAM');
  assert.equal(writes[0].data.workspaceId, 'TTEAM');
});

test('local date rollover and rounded submission times respect the configured timezone', async () => {
 useRows([entry('2026-10-18', { createdAt: new Date('2026-10-18T08:59:00Z') }), entry('2026-10-19', { createdAt: new Date('2026-10-19T09:00:00Z') })]);
 const result = await calculatePerformanceMetrics('UALICE','week','TTEAM',new Date('2026-10-19T16:00:00Z'));
 assert.equal(result.averageSubmissionTime,'12:00');
 assert.equal(result.lateSubmissions,0);
 const rollover = await calculatePerformanceMetrics('UALICE','week','TTEAM',new Date('2026-10-17T22:00:00Z'));
 assert.equal(rollover.endDate,'2026-10-18');
 assert.equal(rollover.totalSubmissions,1);
});

test('known members with no current submissions receive fresh zero metrics instead of retaining old scores', async () => {
  useRows([entry('2026-09-30'), entry('2026-10-18', { workspaceId: 'TOTHER' })]);
  const result = await calculatePerformanceMetrics('UALICE', 'week', 'TTEAM', new Date('2026-10-20T16:00:00Z'));
  assert.ok(result);
  assert.equal(result.totalSubmissions, 0);
  assert.equal(result.totalTasksCompleted, 0);
  assert.equal(result.consistencyScore, 0);
  assert.equal(result.overallScore, 0);
  assert.equal(result.expectedSubmissions, 3);
  assert.ok(result.riskFactors.some(factor => factor.startsWith('Low submission rate')));
});

test('a completely missing risk window is assessed against expected workdays', async () => {
  useRows([]);
  const result = await assessRiskLevel('UALICE',14,'TTEAM',new Date('2026-10-20T16:00:00Z'));
  assert.equal(result.level,'medium');
  assert.ok(result.factors.includes('Low submission rate (0%)'));
});

test('leave records cannot satisfy the minimum sample size for velocity', () => {
  const rows = Array.from({length:10}, (_,i)=>entry(`2026-10-${String(i+1).padStart(2,'0')}`, {isDayOff:i<8,yesterday:i===8?'- One':'- One\n- Two\n- Three'}));
  assert.equal(calculateVelocityTrend(rows),'stable');
});

test('equal performance scores receive equal percentile ranks regardless of roster order', async () => {
  mock.timers.enable({apis:['Date'],now:new Date('2026-10-20T16:00:00Z')});
  const today = '2026-10-20';
  useRows([entry(today),entry(today,{slackUserId:'UBOB',slackUserName:'Bob'})]);
  mock.method(Entry,'distinct',async()=>['UBOB','UALICE']);
  const saved=[];
  mock.method(Metrics,'findOneAndUpdate',async (_filter,data)=>saved.push(data));
  await calculateTeamMetrics('TTEAM','week',new Date('2026-10-20T16:00:00Z'));
  assert.equal(saved.length,2);
  assert.equal(saved[0].overallScore,saved[1].overallScore);
  assert.equal(saved[0].percentileRank,saved[1].percentileRank);
});
