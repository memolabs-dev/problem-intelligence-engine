import test from 'node:test';
import assert from 'node:assert/strict';
import {stableRunId,persistVerifiedRun} from '../packages/storage/model-runs.mjs';

const obs={id:'github:1',url:'https://github.com/acme/x/issues/1',title:'CSV uploads fail on large files',body:'This breaks our processing.',content_hash:'a'.repeat(64)};
const candidate={observationId:obs.id,sourceUrl:obs.url,statement:'CSV upload fails for very large files',excerpt:obs.title};
const report={results:[{observationId:obs.id,status:'found',candidate,verification:{accept:true,category:'observed_failure'}}]};
const opts={provider:'openrouter',model:'nvidia/nemotron-3.5-lightning:free'};
function fakePool(){
 const statements=[];
 let exists=false;
 return {statements,connect:async()=>({release(){},query:async(sql,args)=>{
  statements.push({sql,args});
  if(sql.startsWith('SELECT id,title'))return {rows:[obs]};
  if(sql.startsWith('INSERT INTO model_runs')){if(exists)return {rowCount:0};exists=true;return {rowCount:1,rows:[{id:args[0]}]};}
  return {rowCount:1};
 }})};
}
test('report identity is deterministic and changes when evidence changes',()=>{
 assert.equal(stableRunId(report,opts.provider,opts.model),stableRunId(report,opts.provider,opts.model));
 const modified=structuredClone(report);modified.results[0].candidate.statement='An entirely different failure in the source';
 assert.notEqual(stableRunId(report,opts.provider,opts.model),stableRunId(modified,opts.provider,opts.model));
});
test('transactional verified-run import is idempotent',async()=>{
 const pool=fakePool();
 const first=await persistVerifiedRun(pool,report,opts);
 assert.equal(first.inserted,true);assert.equal(first.decisions,1);
 const second=await persistVerifiedRun(pool,report,opts);
 assert.equal(second.inserted,false);assert.equal(second.decisions,0);
 assert.equal(pool.statements.filter(x=>x.sql.startsWith('INSERT INTO model_decisions')).length,1);
});
test('source mismatch rolls back instead of promoting a candidate',async()=>{
 const bad=structuredClone(report);bad.results[0].candidate.excerpt='No supporting quote exists in the original';
 const pool=fakePool();
 await assert.rejects(persistVerifiedRun(pool,bad,opts),/source-grounded/);
 assert.equal(pool.statements.at(-1).sql,'ROLLBACK');
 assert.equal(pool.statements.filter(x=>x.sql.startsWith('INSERT INTO model_runs')).length,0);
});
test('rejects unreviewed findings',async()=>{
 const bad=structuredClone(report);delete bad.results[0].verification;
 const pool=fakePool();
 await assert.rejects(persistVerifiedRun(pool,bad,opts),/Invalid verified candidate/);
});

test('run identity includes original source fingerprint',()=>{
 const unchanged=stableRunId(report,opts.provider,opts.model,{[obs.id]:'a'.repeat(64)});
 const edited=stableRunId(report,opts.provider,opts.model,{[obs.id]:'b'.repeat(64)});
 assert.notEqual(unchanged,edited);
});
test('refuses stale extraction after a publication changes, even if no problem was found',async()=>{
 const stale={results:[{observationId:obs.id,status:'none',sourceContentHash:'b'.repeat(64)}]};
 const pool=fakePool();
 await assert.rejects(persistVerifiedRun(pool,stale,opts),/Source changed since model extraction/);
 assert.equal(pool.statements.at(-1).sql,'ROLLBACK');
});
test('verified model import records the extraction method',async()=>{
 const pool=fakePool();
 await persistVerifiedRun(pool,report,opts);
 const insert=pool.statements.find(x=>x.sql.startsWith('INSERT INTO model_decisions'));
 assert.match(insert.sql,/extraction_method/);
 assert.equal(insert.args[8],null);
 const labeled=structuredClone(report);labeled.results[0].candidate.method='heuristic-v2';
 const changed=fakePool();await persistVerifiedRun(changed,labeled,opts);
 assert.equal(changed.statements.find(x=>x.sql.startsWith('INSERT INTO model_decisions')).args[8],'heuristic-v2');
});
