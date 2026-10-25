const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
function config(env){return spawnSync(process.execPath,['--require','ts-node/register/transpile-only','-e',"const c=require('./src/config'); process.stdout.write(JSON.stringify([c.WORKING_DAYS,c.METRICS_HOLIDAYS]));"],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,...env},encoding:'utf8'});}
test('invalid calendar configuration is rejected instead of silently adding Sunday or ignoring invalid holidays',()=>{
 for(const WORKING_DAYS of ['1,2,3,4,5,','1,,2',' ,1','-1','7','1.5'])assert.notEqual(config({WORKING_DAYS}).status,0,WORKING_DAYS);
 for(const METRICS_HOLIDAYS of ['2026-02-30','2026-13-01','2026-1-01'])assert.notEqual(config({METRICS_HOLIDAYS}).status,0,METRICS_HOLIDAYS);
});
test('a valid custom workweek and holiday calendar load successfully',()=>{
 const result=config({WORKING_DAYS:'1,2,3,4,5',METRICS_HOLIDAYS:'2026-10-20'});
 assert.equal(result.status,0,result.stderr);
 assert.ok(result.stdout.endsWith('[[1,2,3,4,5],["2026-10-20"]]'));
});
