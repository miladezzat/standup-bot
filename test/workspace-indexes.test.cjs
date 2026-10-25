const { test } = require('node:test');
const assert = require('node:assert/strict');
const { migrateWorkspaceIndexes } = require('../src/migrations/workspace-indexes');
const Entry = require('../src/models/standupEntry').default;
const Thread = require('../src/models/standupThread').default;
const Achievement = require('../src/models/achievements').default;

test('standup and achievement uniqueness include workspace identity', () => {
 for (const model of [Entry,Achievement,Thread]) {
  const unique = model.schema.indexes().filter(([, options]) => options.unique);
  assert.equal(unique.length,1);
  assert.equal(unique[0][0][model === Thread ? 'channelId' : 'workspaceId'],1);
 }
});
function db(failCreate = false, legacy = true) {
 const actions=[];
 return { actions, collection(name) { return {
  indexes: async () => legacy ? [{ name: name === 'standupentries' ? 'slackUserId_1_date_1' : name === 'achievements' ? 'slackUserId_1_achievementType_1_level_1' : 'date_1', unique: true }, { name: 'unrelated_ops_index', unique: true }] : [],
  createIndex: async (keys,options) => { actions.push(['create',name,keys,options]); if (failCreate) throw new Error('index failed'); },
  dropIndex: async index => actions.push(['drop',name,index]),
 }; } };
}
test('migration defaults to dry run and only drops legacy indexes after successful replacement creation', async () => {
 const dry=db(); await migrateWorkspaceIndexes(dry); assert.deepEqual(dry.actions,[]);
 const applied=db(); await migrateWorkspaceIndexes(applied,true);
 assert.deepEqual(applied.actions.map(a=>a[0]),['create','drop','create','drop','create','drop']);
 assert.ok(applied.actions.filter(a=>a[0]==='create').every(a=>(a[2].workspaceId===1 || a[2].channelId===1) && a[3].unique));
 assert.ok(!JSON.stringify(applied.actions).includes('unrelated_ops_index'));
});
test('failed replacement leaves legacy unique index intact; completed migration can be rerun', async () => {
 const failing=db(true); await assert.rejects(migrateWorkspaceIndexes(failing,true), /index failed/);
 assert.equal(failing.actions.length,1);
 const migrated=db(false,false); await migrateWorkspaceIndexes(migrated,true);
 assert.deepEqual(migrated.actions.map(a=>a[0]),['create','create','create']);
});

test('migration can create indexes before a collection exists and propagates other read failures', async () => {
 const created=[];
 const empty={collection(name){return {indexes:async()=>{throw {code:26};},createIndex:async()=>created.push(name),dropIndex:async()=>assert.fail('no legacy index exists')};}};
 await migrateWorkspaceIndexes(empty,true);
 assert.equal(created.length,3);
 const unavailable={collection(){return {indexes:async()=>{throw new Error('database unavailable');}};}};
 await assert.rejects(migrateWorkspaceIndexes(unavailable,true),/database unavailable/);
});
