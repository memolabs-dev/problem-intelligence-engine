import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewAlternatePairs,validateAlternateMiningQueue,ALTERNATE_REVIEW_CURRENT_SQL} from '../packages/agents/review-alternate-pairs.mjs';
const queue={kind:'unreviewed_alternate_embedding_candidates',model:'nomic-embed-text',pairs:[{left:{id:'github:a',runId:'run-a'},right:{id:'github:b',runId:'run-b'}}]};
const source=(id,root=id)=>({run_id:'run-'+id,observation_id:'github:'+id,statement:'Specific failure '+id,excerpt:'The source reports failure '+id,thread_root_id:root,source:'github',url:'https://github.com/a/b/issues/'+id});
function db(rows,{previous=null,recheck=null}={}){
 let reads=0;const writes=[];
 return {writes,query:async(sql,args)=>{
  if(sql===ALTERNATE_REVIEW_CURRENT_SQL){reads++;return {rows:reads===2&&recheck?recheck:rows};}
  if(sql.startsWith('SELECT verdict,rationale FROM corroboration_edges'))return {rows:previous?[previous]:[]};
  if(sql.startsWith('INSERT INTO corroboration_edges')){writes.push(args);return {rowCount:1};}
  throw Error('Unexpected query '+sql.slice(0,30));
 }};
}
test('queue validation rejects duplicate or identical observation pairs',()=>{
 assert.deepEqual(validateAlternateMiningQueue(queue),[['github:a','github:b']]);
 assert.throws(()=>validateAlternateMiningQueue({...queue,pairs:[queue.pairs[0],{left:{id:'github:b',runId:'run-b'},right:{id:'github:a',runId:'run-a'}}]}),/Repeated/);
 assert.throws(()=>validateAlternateMiningQueue({...queue,pairs:[{left:{id:'github:a',runId:'run-a'},right:{id:'github:a',runId:'run-a'}}]}),/Invalid/);
 assert.throws(()=>validateAlternateMiningQueue(queue,{limit:100}),/Invalid/);
});
test('semantic review persists verdict under canonical production reviewer policy and source revisions',async()=>{
 const pool=db([source('a'),source('b')]);let judged=0;
 const result=await reviewAlternatePairs(pool,queue,{judge:async (pair,options)=>{judged++;assert.match(pair.left_excerpt,/failure/);assert.equal(options.env.PIE_LLM_MODEL,'nvidia/nemotron-3.5-lightning:free');return {verdict:'different_problem',rationale:'Different bugs'};}});
 assert.equal(result.reviewed,1);assert.equal(result.differentProblem,1);assert.equal(judged,1);
 assert.equal(pool.writes.length,1);
 assert.match(pool.writes[0][4],/^all-minilm\+nvidia\/nemotron-3\.5-lightning:free\+same-problem-v2$/);
 assert.equal(result.independentHumanLabels,false);
});
test('previous valid verdict is cached without asking the model again',async()=>{
 const pool=db([source('a'),source('b')],{previous:{verdict:'same_problem',rationale:'Same failure'}});
 const result=await reviewAlternatePairs(pool,queue,{judge:async()=>{throw Error('Should not review');}});
 assert.equal(result.cached,1);assert.equal(result.sameProblem,1);assert.equal(pool.writes.length,0);
});
test('missing or reclassified sources cannot enter corroboration evidence',async()=>{
 const pool=db([source('a')]);const result=await reviewAlternatePairs(pool,queue,{judge:async()=>{throw Error('No');}});
 assert.equal(result.results[0].status,'stale_or_unverified');
 assert.equal(pool.writes.length,0);
});
test('a source change during review prevents stale verdict persistence',async()=>{
 const pool=db([source('a'),source('b')],{recheck:[source('a'),{...source('b'),run_id:'new-run'}]});
 const result=await reviewAlternatePairs(pool,queue,{judge:async()=>({verdict:'same_problem',rationale:'Possibly same'})});
 assert.equal(result.results[0].status,'stale_during_review');
 assert.equal(pool.writes.length,0);
});
test('multiple HN replies within same original thread are not reviewed',async()=>{
 const hn=structuredClone(queue);hn.pairs=[{left:{id:'github:a',runId:'run-a'},right:{id:'github:b',runId:'run-b'}}];
 const pool=db([source('a','hackernews:original'),source('b','hackernews:original')]);
 const result=await reviewAlternatePairs(pool,hn,{judge:async()=>{throw Error('Never');}});
 assert.equal(result.results[0].status,'same_original_discussion');
});
test('model errors are tracked separately from semantically negative verdicts',async()=>{
 const pool=db([source('a'),source('b')]);
 const result=await reviewAlternatePairs(pool,queue,{judge:async()=>{throw Error('HTTP 429');}});
 assert.equal(result.errors,1);assert.equal(result.differentProblem,0);assert.equal(pool.writes.length,0);
});

test('candidate report must preserve exact extraction run IDs from mining time',async()=>{
 const pool=db([source('a'),source('b')]);
 const modified=structuredClone(queue);modified.pairs[0].left.runId='older-run';
 const result=await reviewAlternatePairs(pool,modified,{judge:async()=>{throw Error('Must not review stale mining pair');}});
 assert.equal(result.results[0].status,'stale_or_unverified');
 assert.equal(pool.writes.length,0);
 const legacy=structuredClone(queue);delete legacy.pairs[0].right.runId;
 assert.throws(()=>validateAlternateMiningQueue(legacy),/missing source snapshot/);
});
