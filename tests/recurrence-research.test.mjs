import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRecurrenceQueries,loadVerifiedSeeds,runRecurrenceResearch,saveRecurrenceProbe,CURRENT_SEED_PROBLEMS_SQL} from '../packages/agents/recurrence-research.mjs';

const seed=(id='github:1',title='Turbopack ignores webpackChunkName in dynamic imports')=>({
 id,title,statement:'The bundler drops webpackChunkName comments and emits unnamed dynamic import chunks after migration',
 source:'github',url:'https://github.com/acme/app/issues/1',content_hash:'a'.repeat(64)
});
test('recurrence search probes preserve distinctive identifiers, not vague product categories',()=>{
 const queries=buildRecurrenceQueries(seed(),{maxQueries:2});
 assert.equal(queries.length,2);
 assert.ok(queries.every(x=>x.length>=8&&x.length<=130));
 assert.match(queries.join(' '),/webpackChunkName/);
 assert.deepEqual(queries,buildRecurrenceQueries(seed(),{maxQueries:2}));
 assert.throws(()=>buildRecurrenceQueries({title:'No seed'}),/verified source/);
});
test('seed retrieval accepts only current quoted verified problems',async()=>{
 const p={query:async(sql,args)=>{
  assert.equal(sql,CURRENT_SEED_PROBLEMS_SQL);
  assert.match(sql,/m\.source_content_hash=o\.content_hash/);
  assert.match(sql,/m\.status='found'/);
  assert.deepEqual(args[0],['github:1']);
  return {rows:[seed()]};
 }};
 const result=await loadVerifiedSeeds(p,{observationIds:['github:1'],maxSeeds:1});
 assert.equal(result.length,1);
 await assert.rejects(loadVerifiedSeeds({query:async()=>({rows:[]})},{observationIds:['github:unknown'],maxSeeds:1}),/No source-current verified seed/);
});
test('dry run generates a bounded plan without search, model calls or writes',async()=>{
 let called=false;
 const result=await runRecurrenceResearch(null,{
  observationIds:['github:1'],maxSeeds:1,maxQueries:2,dryRun:true,
  loadSeeds:async()=>[seed()],cycle:async()=>{called=true;throw Error('never call');},saveAudit:async()=>{called=true;}
 });
 assert.equal(called,false);
 assert.equal(result.plannedProbes,2);
 assert.equal(result.results[0].status,'planned');
 assert.equal(result.independentDemandEstablished,false);
});
test('live probes are bounded, audited, and do not turn model findings into verified independent buyers',async()=>{
 const queries=[],audits=[];
 const result=await runRecurrenceResearch(null,{
  observationIds:['github:1'],maxSeeds:1,maxQueries:2,perSource:3,maxAnalyze:2,maxPairs:3,
  loadSeeds:async()=>[seed()],
  cycle:async(_pool,query,opts)=>{
   queries.push({query,...opts});
   return {sourceSearch:{uniqueObservations:3,distinctSourceAccounts:2,repeatedPostsFromKnownAccounts:1},
    extraction:{total:2,found:1,error:0},corroboration:{sameProblem:1,errors:0}};
  },
  saveAudit:async(_pool,row)=>{audits.push(row);return 'audit-x';}
 });
 assert.equal(result.completed,2);assert.equal(result.failed,0);
 assert.equal(queries.length,2);assert.equal(queries[0].perSource,3);
 assert.equal(queries[0].maxAnalyze,2);
 assert.equal(audits[0].status,'completed');
 assert.equal(result.results[0].sameAccountPosts,1);
 assert.equal(result.independentDemandEstablished,false);
 assert.equal(result.commercialValidation,'unknown');
});
test('source outage or reviewer errors do not abort the other probes',async()=>{
 let calls=0;
 const result=await runRecurrenceResearch(null,{
  observationIds:['github:1'],maxSeeds:1,maxQueries:2,loadSeeds:async()=>[seed()],
  cycle:async()=>{
   calls++;if(calls===1)throw Error('HTTP 503');
   return {sourceSearch:{uniqueObservations:2,incomplete:true},extraction:{found:0,error:0}};
  },
  saveAudit:async()=>String(calls)
 });
 assert.equal(result.failed,1);assert.equal(result.partial,1);
 assert.equal(result.results[0].error,'HTTP 503');
});
test('invalid budgets rejected before opening public connections',async()=>{
 let called=false;
 await assert.rejects(runRecurrenceResearch(null,{maxSeeds:10,loadSeeds:async()=>{called=true;return []}}),/Invalid bounded recurrence budget/);
 assert.equal(called,false);
});
test('saved recurrence audit contains source provenance, not fabricated human validation',async()=>{
 let sql,args;
 const pool={query:async(s,a)=>{sql=s;args=a;return {rowCount:1};}};
 const result={sourceSearch:{searchRunId:'00000000-0000-4000-8000-000000000002',uniqueObservations:2,distinctSourceAccounts:1},extraction:{total:1,found:1},corroboration:{sameProblem:1}};
 await saveRecurrenceProbe(pool,{seed:seed(),query:'webpackChunkName dynamic import',result,status:'completed'});
 assert.match(sql,/INSERT INTO recurrence_probe_runs/);
 assert.equal(args[1],'github:1');
 assert.equal(args[5],'completed');
 const saved=JSON.parse(args[7]);
 assert.equal(saved.verifiedProblems,1);
 assert.equal(saved.knownSourceAccounts,1);
 assert.equal(saved.independentlyVerifiedPeople,undefined);
});

test('search query retains specific failure and network protocol identifiers instead of generic prose',()=>{
 const queries=buildRecurrenceQueries({id:'github:hang',title:'Bun HTTP client hangs until abort despite ACKed inbound TLS data',statement:'Bun HTTP client hangs on keep-alive TLS connections after inbound data is acknowledged'},{maxQueries:2});
 assert.match(queries[0],/Bun/);
 assert.match(queries[0],/TLS/);
 assert.match(queries[0],/ACKed/);
 assert.match(queries[0],/hangs/);
 assert.doesNotMatch(queries[0],/until|despite/);
 assert.ok(queries.every(x=>x.length<=130));
});
test('query generation preserves platform from source statement even if missing in title',()=>{
 const queries=buildRecurrenceQueries({id:'github:worker',title:'Web workers cannot be unreffed',statement:'Web workers in Deno cannot be unreffed and block the event loop from exiting'},{maxQueries:2});
 assert.match(queries[0],/Deno/);
 assert.match(queries[0],/unreffed/);
 assert.notEqual(queries[0],queries[1]);
});

test('GitHub recurrence probes are compact rather than requiring every word to match',()=>{
 const examples=[
  {id:'github:bun',title:'Bun HTTP client hangs until abort despite ACKed inbound TLS data',statement:'Bun HTTP client keep-alive stalls after acknowledged data'},
  {id:'github:deno',title:'Web workers cannot be unreffed',statement:'Web workers in Deno cannot be unreffed and block the event loop'},
  {id:'github:next',title:'Turbopack ignores webpackChunkName in dynamic imports',statement:'The bundler drops webpackChunkName comments'}
 ];
 for(const item of examples){
  const queries=buildRecurrenceQueries(item,{maxQueries:3});
  assert.ok(queries.length>=2);
  assert.ok(queries.every(q=>q.trim().split(/\\s+/).length<=4),JSON.stringify(queries));
  assert.ok(queries.every(q=>q.length>=8&&q.length<=130));
 }
});

test('ordinary word next is not mistaken for the Next.js platform',()=>{
 const row={id:'github:routing',title:'Prefetch loop: optimistic routing drops a parallel slot next to a static segment',
 statement:'A route parameter disappears in a parallel slot next to a static segment'};
 const queries=buildRecurrenceQueries(row,{maxQueries:2});
 assert.ok(queries.every(query=>query.split(/\\s+/).length<=4));
 assert.ok(queries.every(query=>!query.includes('loop:')));
 assert.ok(queries.some(query=>/prefetch|routing/i.test(query)));
});
