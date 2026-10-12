import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPool,saveObservations} from '../packages/storage/postgres.mjs';
import {saveRecurrenceProbe} from '../packages/agents/recurrence-research.mjs';

test('PostgreSQL stores a recurrence probe linked to a real seed and source fingerprint',async t=>{
 if(process.env.PIE_INTEGRATION!=='1')return t.skip('set PIE_INTEGRATION=1');
 const db=createPool();
 const id='github:research-integration-'+process.pid;
 const contentHash=createHash('sha256').update('integration seed').digest('hex');
 let probeId;
 try{
  await saveObservations(db,[{id,source:'github',externalId:id.slice(7),url:'https://github.com/example/repo/issues/2',
   title:'A specific flaky chunk naming regression',body:'Original source body',contentHash,publishedAt:null}]);
  const seed={id,content_hash:contentHash};
  probeId=await saveRecurrenceProbe(db,{seed,query:'webpackChunkName regression',status:'partial',
   result:{sourceSearch:{uniqueObservations:2,distinctSourceAccounts:1},
    extraction:{total:1,found:1},corroboration:{sameProblem:0,errors:1}}});
  const {rows}=await db.query('SELECT query,status,seed_content_hash,result_summary FROM recurrence_probe_runs WHERE id=$1',[probeId]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].query,'webpackChunkName regression');
  assert.equal(rows[0].status,'partial');
  assert.equal(rows[0].seed_content_hash.trim(),contentHash);
  assert.equal(rows[0].result_summary.verifiedProblems,1);
  assert.equal(rows[0].result_summary.reviewerErrors,1);
 }finally{
  if(probeId)await db.query('DELETE FROM recurrence_probe_runs WHERE id=$1',[probeId]);
  await db.query('DELETE FROM observations WHERE id=$1',[id]);
  await db.end();
 }
});
