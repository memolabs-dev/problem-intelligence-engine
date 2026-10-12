import test from 'node:test';
import assert from 'node:assert/strict';
import {batchExtractLLM} from '../packages/agents/batch-llm.mjs';
test('batch captures valid, empty, and failed extractions without aborting',async()=>{
 const rows=[{id:'a'},{id:'b'},{id:'c'}];let n=0;const emitted=[];
 const result=await batchExtractLLM({query:async()=>({rows})},{extract:async()=>{n++;if(n===1)return {statement:'ok'};if(n===2)return null;throw Error('bad quote')},onResult:r=>emitted.push(r)});
 assert.equal(result.total,3);assert.equal(result.found,1);assert.equal(result.none,1);assert.equal(result.error,1);assert.equal(emitted.length,3);assert.equal(result.results[2].error,'bad quote');
});
test('retries a bad evidence quote once and accepts only validated follow-up',async()=>{
 let attempts=0;const result=await batchExtractLLM({query:async()=>({rows:[{id:'a'}]})},{extract:async()=>{attempts++;if(attempts===1)throw Error('Evidence quote not present in observation');return {statement:'verified'}}});
 assert.equal(attempts,2);assert.equal(result.found,1);assert.equal(result.error,0);
});
test('does not retry unrelated errors',async()=>{
 let attempts=0;const result=await batchExtractLLM({query:async()=>({rows:[{id:'a'}]})},{extract:async()=>{attempts++;throw Error('LLM HTTP 429')}});
 assert.equal(attempts,1);assert.equal(result.error,1);
});

test('targets only selected observation IDs without a full batch',async()=>{
 const old=process.env.PIE_LLM_OBSERVATION_IDS;process.env.PIE_LLM_OBSERVATION_IDS='a,b';
 try{let sql,params;const report=await batchExtractLLM({query:async(q,p)=>{sql=q;params=p;return {rows:[{id:'a'},{id:'b'}]}}},{extract:async()=>null});assert.match(sql,/WHERE id = ANY/);assert.deepEqual(params,[['a','b']]);assert.equal(report.total,2)}finally{if(old===undefined)delete process.env.PIE_LLM_OBSERVATION_IDS;else process.env.PIE_LLM_OBSERVATION_IDS=old}
});

test('retries a structured HTTP 429 once',async()=>{
 let attempts=0;const report=await batchExtractLLM({query:async()=>({rows:[{id:'rate-limit'}]})},{extract:async()=>{attempts++;if(attempts===1){const error=new Error('LLM HTTP 429');error.status=429;error.retryAfter='0';throw error;}return {statement:'verified'};}});
 assert.equal(attempts,2);assert.equal(report.found,1);assert.equal(report.error,0);
});
test('retries a timeout once then reports failure',async()=>{
 let attempts=0;const report=await batchExtractLLM({query:async()=>({rows:[{id:'timeout'}]})},{extract:async()=>{attempts++;const error=new Error('deadline');error.name='TimeoutError';throw error;}});
 assert.equal(attempts,2);assert.equal(report.error,1);assert.equal(report.results[0].error,'timeout');
});


test('truncated inference gets a single bounded higher-budget retry',async()=>{
 const calls=[];
 const report=await batchExtractLLM({query:async()=>({rows:[{id:'evidence-test'}]})},{extract:async(_obs,opts)=>{calls.push(opts);if(calls.length===1){const err=new Error('LLM output truncated (finish_reason=length)');err.code='LLM_OUTPUT_TRUNCATED';throw err;}return {statement:'Validated result'};}});
 assert.equal(calls.length,2);assert.equal(calls[1].maxTokens,6144);assert.equal(calls[1].reasoningEffort,'none');assert.equal(report.found,1);assert.equal(report.error,0);
});
test('malformed JSON response may retry but never becomes a success on repeated failure',async()=>{
 let attempts=0;const report=await batchExtractLLM({query:async()=>({rows:[{id:'malformed'}]})},{extract:async()=>{attempts++;const err=new Error('Invalid LLM JSON output');err.code='LLM_INVALID_JSON';throw err;}});
 assert.equal(attempts,2);assert.equal(report.error,1);assert.equal(report.found,0);
});


test('verified batch applies candidate review without promoting rejected outputs',async()=>{
 const {verifiedBatchExtractLLM}=await import('../packages/agents/batch-llm.mjs');
 const rows=[{id:'a',title:'Fails during upload',body:'Large uploads fail.',url:'https://example.org/a'},{id:'b',title:'Favorite books',body:'Which is yours?',url:'https://example.org/b'}];
 const pool={query:async()=>({rows})};
 const result=await verifiedBatchExtractLLM(pool,{
  extract:async obs=>({statement:'Some extracted claim',observationId:obs.id,excerpt:obs.title}),
  judge:async obs=>obs.id==='a'?{accept:true,category:'observed_failure'}:{accept:false,category:'generic_question'}
 });
 assert.equal(result.raw.found,2);assert.equal(result.verified.found,1);assert.equal(result.verified.rejected,1);
 assert.equal(result.verified.results[1].candidate,undefined);
});


test('recoverable invalid LLM output may use a clearly labeled heuristic fallback',async()=>{
 const rows=[{id:'github:x',title:'CSV uploads fail on large files',body:'Upload stops at the end.',url:'https://example.org/x'}];
 const errors=[];
 const out=await batchExtractLLM({query:async()=>({rows})},{
  extract:async()=>{throw Error('Invalid problem statement');},
  fallback:row=>({statement:row.title,excerpt:row.title,observationId:row.id,sourceUrl:row.url,method:'heuristic-v2'}),
  onResult:r=>errors.push(r)
 });
 assert.equal(out.found,1);assert.equal(out.error,0);assert.equal(out.recovered,1);
 assert.equal(out.results[0].candidate.method,'heuristic-v2');
 assert.equal(out.results[0].recovery.kind,'heuristic_fallback');
});
test('heuristic fallback does not mask network failures',async()=>{
 const rows=[{id:'github:x',title:'CSV uploads fail on large files',body:'',url:'https://example.org/x'}];
 let fallbackCalled=false;
 const out=await batchExtractLLM({query:async()=>({rows})},{
  extract:async()=>{throw Error('LLM HTTP 403');},
  fallback:()=>{fallbackCalled=true;return {statement:'example'};}
 });
 assert.equal(fallbackCalled,false);assert.equal(out.error,1);assert.equal(out.recovered,0);
});

test('default batch chooses most recently published observations and snapshots source hashes',async()=>{
 const existing=process.env.PIE_LLM_OBSERVATION_IDS;
 const strategy=process.env.PIE_LLM_SELECTION;
 delete process.env.PIE_LLM_OBSERVATION_IDS;
 process.env.PIE_LLM_SELECTION='recent';
 try{
  let sql;
  const row={id:'github:recent',content_hash:'a'.repeat(64)};
  const report=await batchExtractLLM({query:async statement=>{sql=statement;return {rows:[row]};}},{extract:async()=>null});
  assert.match(sql,/ORDER BY published_at DESC NULLS LAST, id DESC LIMIT/);
  assert.equal(report.results[0].sourceContentHash,row.content_hash);
 }finally{
  if(existing===undefined)delete process.env.PIE_LLM_OBSERVATION_IDS;else process.env.PIE_LLM_OBSERVATION_IDS=existing;
  if(strategy===undefined)delete process.env.PIE_LLM_SELECTION;else process.env.PIE_LLM_SELECTION=strategy;
 }
});

test('explicit observation selection overrides inherited environment filters and respects budget',async()=>{
 const old=process.env.PIE_LLM_OBSERVATION_IDS;
 process.env.PIE_LLM_OBSERVATION_IDS='github:unrelated';
 try{
  let params;
  const result=await batchExtractLLM({query:async(_sql,p)=>{params=p;return {rows:[{id:'github:intended'}]};}},{
   observationIds:['github:intended','github:another','github:intended'],limit:1,extract:async()=>null
  });
  assert.deepEqual(params,[['github:intended']]);
  assert.equal(result.total,1);
 }finally{
  if(old===undefined)delete process.env.PIE_LLM_OBSERVATION_IDS;
  else process.env.PIE_LLM_OBSERVATION_IDS=old;
 }
});
test('an explicit empty candidate list never selects unrelated recent observations',async()=>{
 let queried=false;
 const result=await batchExtractLLM({query:async()=>{queried=true;throw Error('should not query');}},{
  observationIds:[],limit:3,extract:async()=>null
 });
 assert.equal(result.total,0);
 assert.equal(queried,false);
});
