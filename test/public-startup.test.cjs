const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IncomingMessage, ServerResponse } = require('node:http');
const { Socket } = require('node:net');
const express = require('express');
const { stub } = require('./helpers.cjs');
process.env.ALLOW_PUBLIC_DASHBOARD = 'true';
process.env.SLACK_TEAM_ID = 'TTEAM';
process.env.CHANNEL_ID = 'CTEAM';
process.env.SLACK_BOT_TOKEN = 'test-bot';
process.env.SLACK_SIGNING_SECRET = 'test-secret';
process.env.SLACK_APP_TOKEN = 'test-app';
process.env.MONGODB_URI = 'mongodb://unused/test';
delete process.env.CLERK_PUBLISHABLE_KEY;
delete process.env.CLERK_SECRET_KEY;
const app=express();
// Actual Express global middleware stack and route registration; only external
// startup work and the final dashboard renderer are replaced.
app.listen = (_port, callback) => { callback?.(); return {}; };
stub('src/singleton/index.ts', { expressApp: app, slackApp: {command(){},action(){},view(){},event(){},start:async()=>{},client:{}}, slackWebClient:{} });
stub('src/db/connection.ts', {connectToDatabase:async()=>{}});
stub('src/jobs/index.ts', {runJobs:async()=>{}});
stub('src/service/submissions-dashboard.service.ts', { getSubmissionsDashboard: (_req,res)=>res.send('Public dashboard reached') });
require('../src/index');

test('actual startup serves a dashboard through global middleware in explicit public mode without Clerk keys', async () => {
 const req=new IncomingMessage(new Socket());
 req.url='/submissions';req.method='GET';req.headers={host:'localhost'};
 const res=new ServerResponse(req);
 let body='';
 await new Promise((resolve,reject)=>{
  res.end = chunk=> { body+=chunk ? String(chunk):''; resolve(); return res; };
  app.handle(req,res,error=>error ? reject(error):resolve());
 });
 assert.equal(res.statusCode,200);
 assert.equal(body,'Public dashboard reached');
});
