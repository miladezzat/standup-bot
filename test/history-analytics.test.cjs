const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
process.env.SLACK_TEAM_ID='TTEAM';
process.env.CHANNEL_ID='CTEAM';
const { stub, query, response } = require('./helpers.cjs');
const infoCalls=[];
const apiId=require.resolve('@slack/web-api');
require.cache[apiId]={id:apiId,filename:apiId,loaded:true,exports:{WebClient:class {constructor(){this.users={info:async({user})=>{infoCalls.push(user);return {user:{name:user,profile:{real_name:user}}};}};}}}};
let messages=[{ts:'1001',user:'UALICE',text:'yesterday: - Shipped BOT-123\ntoday: - Next plan\nblockers: none'}];
stub('src/singleton/index.ts',{slackWebClient:{conversations:{replies:async({channel})=>{assert.equal(channel,'CTEAM');return {messages};}}}});
const Entry=require('../src/models/standupEntry').default;
const Thread=require('../src/models/standupThread').default;
const {generateDateAnalytics}=require('../src/helper');
const {getStandupHistory}=require('../src/service/standup-history.service');
const thread={date:'2026-10-20',threadTs:'1000',channelId:'CTEAM'};
const local={workspaceId:'TTEAM',date:thread.date,slackUserId:'UALICE',isDayOff:true,dayOffReason:'Local leave <coverage>',yesterday:'Day off',today:'Day off'};
afterEach(()=>{mock.restoreAll();infoCalls.length=0;});

test('actual history rendering excludes foreign leave details for both different and reused Slack IDs',async()=>{
 for(const foreignId of ['UFOREIGN','UALICE']){
  const rows=[local,{...local,workspaceId:'TOTHER',slackUserId:foreignId,dayOffReason:'PRIVATE_FOREIGN_REASON'}];
  const filters=[];
  mock.method(Entry,'find',filter=>{filters.push(filter);return query(rows,filter);});
  mock.method(Thread,'find',filter=>query([thread],filter));
  const res=response();
  await getStandupHistory({query:{date:thread.date}},res);
  assert.equal(res.statusCode,200);
  assert.ok(res.data.includes('Local leave &lt;coverage&gt;'));
  assert.ok(!res.data.includes('PRIVATE_FOREIGN_REASON'));
  assert.ok(!res.data.includes('UFOREIGN'));
  assert.ok(!infoCalls.includes('UFOREIGN'));
  assert.ok(filters.length>0 && filters.every(f=>f.workspaceId==='TTEAM'&&f.date===thread.date));
  mock.restoreAll();
 }
});

test('empty thread reply behavior is preserved without reading standup records',async()=>{
 messages=[];
 const find=mock.method(Entry,'find',()=>assert.fail('empty thread should not query standups'));
 assert.equal(await generateDateAnalytics(thread),'');
 assert.equal(find.mock.callCount(),0);
});

test('legacy task totals count completed lines without planned work or issue-ID hyphens',async()=>{
 messages=[{ts:'1001',user:'UALICE',text:'yesterday: - Shipped BOT-123\ntoday: - Plan one\n- Plan two\nblockers: none'}];
 mock.method(Entry,'find',filter=>query([],filter));
 const html=await generateDateAnalytics(thread);
 assert.match(html,/metric-value">1<\/div>\s*<div class="metric-label">Tasks completed per person/);
});
