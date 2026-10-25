const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
process.env.SLACK_TEAM_ID = 'TTEAM';
process.env.CHANNEL_ID = 'CTEAM';
const { stub, query, matches } = require('./helpers.cjs');
const posted=[];
const client = { chat: { postMessage: async data => { posted.push(data); return {ts:'thread-ts'}; } }, users: { info: async () => ({user:{}}) }, views: { open: async () => {} } };
stub('src/singleton/index.ts', { slackWebClient: client, slackApp: { client } });
const Entry = require('../src/models/standupEntry').default;
const Alert = require('../src/models/alerts').default;
const { handleStandupSubmission, handleStandupSlashCommand, openStandupModal } = require('../src/service/standup-submission.service');
const { runAlertChecks } = require('../src/service/alert-engine.service');
const { generateMonthlyReport } = require('../src/service/monthly-report.service');
afterEach(() => { mock.restoreAll(); mock.timers.reset(); posted.length=0; });
function freeze() { mock.timers.enable({apis:['Date'],now:new Date('2026-10-20T16:00:00Z')}); }

test('standup and OOO upserts include workspace in lookup and saved identity', async () => {
 freeze(); const writes=[];
 mock.method(Entry,'findOneAndUpdate', async (filter,data) => { writes.push({filter,data}); return {...data,_id:'record'}; });
 const values={ yesterday_block:{yesterday_input:{value:'Shipped BOT-123'}},today_block:{today_input:{value:'Next task'}} };
 await handleStandupSubmission({ ack:async()=>{},body:{user:{id:'UALICE',name:'Alice'},team:{id:'TTEAM'}},view:{state:{values}},client });
 await handleStandupSlashCommand({ack:async()=>{},body:{user_id:'UALICE',user_name:'Alice',team_id:'TTEAM',text:'ooo vacation'},client,respond:async()=>{}});
 assert.equal(writes.length,2);
 assert.ok(writes.every(w=>w.filter.workspaceId==='TTEAM'&&w.data.workspaceId==='TTEAM'&&w.filter.slackUserId==='UALICE'));
});

test('button/modal prefill reads the same Slack identity and configured workspace', async () => {
 freeze(); const filters=[];
 mock.method(Entry,'findOne', async filter => {filters.push(filter);return null;});
 for (const body of [{user_id:'UALICE',team_id:'TTEAM'},{user:{id:'UALICE'},team:{id:'TTEAM'}}]) await openStandupModal({client,body});
 assert.equal(filters.length,2);
 assert.ok(filters.every(f=>f.workspaceId==='TTEAM'&&f.slackUserId==='UALICE'));
});

test('missing or planned-only hour estimates do not create low-activity capacity alerts', async () => {
 freeze();
 const rows = ['17','18','19','20'].map(day=>({_id:day,workspaceId:'TTEAM',slackUserId:'UALICE',slackUserName:'Alice',date:`2026-10-${day}`,yesterday:'Work',today:'Plan',todayHoursEstimate:24,blockers:''}));
 mock.method(Entry,'distinct',async (_field,filter)=>[...new Set(rows.filter(row=>matches(row,filter)).map(row=>row.slackUserId))]);
 mock.method(Entry,'find',filter=>query(rows,filter));
 mock.method(Entry,'countDocuments',async filter=>rows.filter(row=>matches(row,filter)).length);
 mock.method(Entry,'findOne',filter=>query(rows,filter,true));
 mock.method(Alert,'findOne',async()=>null);
 const created=[];
 mock.method(Alert,'create',async data=>{created.push(data);return data;});
 mock.method(Alert,'updateMany',async()=>({modifiedCount:0}));
 for (const plannedHours of [24, undefined]) {
  rows.forEach(row => { row.todayHoursEstimate = plannedHours; });
  await runAlertChecks('TTEAM');
  assert.ok(!created.some(a=>a.type==='capacity'));
 }
});

test('monthly report handles full leave and weekend submissions without invalid rates or progress bars', async () => {
 mock.timers.enable({apis:['Date'],now:new Date('2026-11-01T10:00:00Z')});
 const rows = [1,2,3].map(day=>({_id:String(day),workspaceId:'TTEAM',slackUserId:'UALICE',slackUserName:'Alice',date:`2026-10-0${day}`,yesterday:'- Done',today:'Plan',blockers:'None',isDayOff:day===1}));
 mock.method(Entry,'find',filter=>query(rows,filter));
 await generateMonthlyReport();
 assert.equal(posted.length,1);
 const text=JSON.stringify(posted[0]);
 assert.ok(!text.includes('NaN'));
 assert.ok(text.includes('0/20 days'));
});


test('reminder thread upsert is channel scoped and uses the local date', async () => {
 mock.timers.enable({apis:['Date'],now:new Date('2026-10-17T22:00:00Z')});
 const cronId = require.resolve('cron');
 require.cache[cronId] = { id: cronId, filename: cronId, loaded: true, exports: { CronJob: class { constructor(_schedule,callback) { this.fireOnTick=callback; } } } };
 const Thread = require('../src/models/standupThread').default;
 const writes=[];
 mock.method(Thread,'findOneAndUpdate',async(filter,data)=>{writes.push({filter,data});});
 await require('../src/jobs/stand-up-reminder').standupReminder.fireOnTick();
 assert.equal(writes.length,1);
 assert.deepEqual(writes[0].filter,{channelId:'CTEAM',date:'2026-10-18'});
 assert.equal(writes[0].data.channelId,'CTEAM');
});
