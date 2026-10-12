import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPendingObservations,findPendingObservations,runDiscoveryCycle,CURRENT_SOURCE_DECISIONS_SQL} from '../packages/agents/discovery-cycle.mjs';

const source=(id,status=null,prior=null)=>({id,content_hash:'a'.repeat(64),status,source_content_hash:prior});
const search=async()=>({
 query:'CSV streaming import fails',observationIds:['github:known','github:new'],incomplete:false,
 uniqueObservations:2,distinctSourceAccounts:2,repeatedPostsFromKnownAccounts:0
});
const environment={OPENROUTER_API_KEY:'test-key'};
test('source revision-aware triage skips only current, completed decisions',()=>{
 const ids=['github:known','github:changed','github:error','github:missing'];
 const rows=[
  source('github:known','found','a'.repeat(64)),
  source('github:changed','none','b'.repeat(64)),
  source('github:error','error','a'.repeat(64))
 ];
 const r=classifyPendingObservations(ids,rows);
 assert.deepEqual(r.previouslyReviewed,['github:known']);
 assert.deepEqual(r.pending,['github:changed','github:error']);
 assert.deepEqual(r.missing,['github:missing']);
});
test('pending lookup uses a single parameterized query',async()=>{
 const calls=[];
 const pool={query:async(sql,params)=>{calls.push({sql,params});return {rows:[source('github:a'),source('github:b','none','a'.repeat(64))]};}};
 const result=await findPendingObservations(pool,['github:a','github:b']);
 assert.deepEqual(result.pending,['github:a']);
 assert.deepEqual(result.previouslyReviewed,['github:b']);
 assert.equal(calls[0].sql,CURRENT_SOURCE_DECISIONS_SQL);
 assert.deepEqual(calls[0].params,[['github:a','github:b']]);
});
test('complete discovery cycle calls each stage with bounded explicit IDs, preserving cautious evidence status',async()=>{
 const calls=[];
 const report=await runDiscoveryCycle({},'CSV streaming import fails',{
  env:environment,maxAnalyze:2,
  discovery:search,
  pendingLookup:async(_db,ids)=>{calls.push('triage');assert.equal(ids.length,2);return {pending:['github:new'],previouslyReviewed:['github:known'],missing:[]};},
  analyze:async(_db,opts)=>{
   calls.push('analyze');
   assert.deepEqual(opts.observationIds,['github:new']);
   assert.equal(opts.limit,2);
   return {raw:{recovered:0},verified:{total:1,found:1,rejected:0,none:0,error:0,results:[{observationId:'github:new',status:'found'}]}};
  },
  persist:async(_db,verified,opts)=>{calls.push('persist');assert.equal(opts.provider,'openrouter');return {runId:'fake',decisions:1};},
  embed:async()=>{calls.push('embed');return {inserted:1,unchanged:2,errors:0};},
  corroborate:async(_db,opts)=>{
   calls.push('corroborate');assert.deepEqual(opts.observationIds,['github:new']);
   return {pairsEvaluated:1,cachedPairs:0,verifiedSameProblem:1,rejectedPairs:0,uncertain:0,errors:0,groups:[{
    observationCount:2,distinctAccountCount:1,
    members:[{observationId:'github:known'},{observationId:'github:new'}]
   }]};
  }
 });
 assert.deepEqual(calls,['triage','analyze','persist','embed','corroborate']);
 assert.equal(report.alreadyReviewed,1);
 assert.equal(report.extraction.found,1);
 assert.equal(report.corroboration.sameProblem,1);
 assert.equal(report.commercialValidation,'unknown');
 assert.equal(report.isIndependentDemandEstablished,false);
 assert.equal(report.corroboration.groups[0].distinctAccountCount,1);
});
test('rerunning when all source revisions are already reviewed performs no extra inference',async()=>{
 let calls=0;
 const result=await runDiscoveryCycle({},'CSV streaming import fails',{
  env:environment,discovery:search,
  pendingLookup:async()=>({pending:[],previouslyReviewed:['github:known','github:new'],missing:[]}),
  analyze:async()=>{calls++;throw Error('unexpected remote model call');},
  persist:async()=>{calls++;throw Error('unexpected persistence');}
 });
 assert.equal(calls,0);
 assert.equal(result.extraction.total,0);
 assert.equal(result.alreadyReviewed,2);
 assert.equal(result.corroboration,null);
});
test('free model guard and invalid limits fail before public search',async()=>{
 let called=0;
 const opts={env:environment,discovery:async()=>{called++;throw Error('should not search');}};
 await assert.rejects(runDiscoveryCycle({},'CSV streaming import fails',{...opts,model:'paid/model'}),/only accepts free/);
 await assert.rejects(runDiscoveryCycle({},'CSV streaming import fails',{...opts,maxAnalyze:99}),/Invalid maxAnalyze/);
 await assert.rejects(runDiscoveryCycle({},'CSV streaming import fails',{...opts,env:{}}),/Missing OpenRouter key/);
 assert.equal(called,0);
});

test('source-diverse selection includes HN comments before exhausting model budget on GitHub',async()=>{
 const {selectDiverseDiscoveryCandidates}=await import('../packages/agents/discovery-cycle.mjs');
 const ids=['github:1','github:2','hackernews:3','hackernews:4','hackernews:5'];
 const types={'github:1':'github_issue','github:2':'github_issue','hackernews:3':'hackernews_story','hackernews:4':'hackernews_comment','hackernews:5':'hackernews_comment'};
 const chosen=selectDiverseDiscoveryCandidates(ids,types,3);
 assert.deepEqual(chosen,['hackernews:4','github:1','hackernews:3']);
 assert.equal(new Set(chosen).size,3);
 assert.deepEqual(selectDiverseDiscoveryCandidates(ids,types,2),['hackernews:4','github:1']);
});
