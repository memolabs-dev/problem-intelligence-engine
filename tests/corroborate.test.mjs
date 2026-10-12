import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePairVerdict,verifyProblemPair,compileCorroborationGroups,runCorroboration,NEAREST_PAIRS_SQL,attachThreadSignals} from '../packages/agents/corroborate.mjs';

const node=(id,accountKey=null)=>({id,runId:'00000000-0000-5000-a000-000000000001',statement:'Some reported issue at '+id,source:'github',url:'https://github.com/a/b/issues/'+id,accountKey});
const pair=(a,b)=>({
 left_id:a.id,right_id:b.id,left_run:a.runId,right_run:b.runId,
 left_statement:a.statement,right_statement:b.statement,left_excerpt:'The system fails on large files',right_excerpt:'The system fails for large files',
 left_url:a.url,right_url:b.url,left_source:a.source,right_source:b.source,left_account:a.accountKey,right_account:b.accountKey,
 similarity:0.8
});
test('strict pair verdict rejects malformed decisions',()=>{
 assert.equal(validatePairVerdict({verdict:'same_problem',rationale:'Same underlying failure.'}).verdict,'same_problem');
 assert.throws(()=>validatePairVerdict({verdict:'kinda',rationale:'?' }),/Invalid pair/);
});
test('complete-link corroboration cannot merge by transitive chain',()=>{
 const a=node('a'),b=node('b'),c=node('c');
 const pairs=[pair(a,b),pair(b,c)];
 const edges=[{left_id:'a',right_id:'b',verdict:'same_problem'},{left_id:'b',right_id:'c',verdict:'same_problem'}];
 const groups=compileCorroborationGroups(pairs,edges,[a,b,c]);
 assert.equal(groups.length,2);
 assert.equal(groups[0].observationCount,2);
 assert.equal(groups[1].observationCount,1);
});
test('no pairs means isolated candidates are retained as single observations',()=>{
 const groups=compileCorroborationGroups([],[],[node('a'),node('b')]);
 assert.equal(groups.length,2);
 assert.ok(groups.every(g=>g.corroboration==='single_observation'));
});
test('distinct accounts are not claimed to be independent people',()=>{
 const a=node('a','account-a'),b=node('b','account-b');
 const groups=compileCorroborationGroups([pair(a,b)],[{left_id:'a',right_id:'b',verdict:'same_problem'}],[a,b]);
 assert.equal(groups[0].distinctAccountCount,2);
 assert.equal(groups[0].independentHumanCount,null);
});
test('Nemotron pair reviewer uses structured tool output and no paid model',async()=>{
 let request;
 const a=node('a'),b=node('b');
 const verdict=await verifyProblemPair(pair(a,b),{env:{PIE_LLM_PROVIDER:'openrouter',PIE_LLM_MODEL:'nvidia/nemotron-3.5-lightning:free',OPENROUTER_API_KEY:'mock'},fetcher:async(_url,options)=>{
  request=JSON.parse(options.body);
  return {ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'submit_corroboration_verdict',arguments:'{"verdict":"different_problem","rationale":"Two unrelated workflows."}'}}]}}]})};
 }});
 assert.equal(request.tool_choice.function.name,'submit_corroboration_verdict');
 assert.equal(verdict.verdict,'different_problem');
});
test('corroboration run keeps an explicit verdict without auto-merging',async()=>{
 const a=node('a'),b=node('b');
 const calls=[];
 const pool={query:async(sql,params)=>{
  calls.push([sql,params]);
  if(sql===NEAREST_PAIRS_SQL)return {rows:[pair(a,b)]};
  if(sql.includes('SELECT run_id AS'))return {rows:[a,b]};
  if(sql.includes('FROM conversation_support s'))return {rows:[]};
  return {rowCount:1};
 }};
 const result=await runCorroboration(pool,{judge:async()=>({verdict:'different_problem',rationale:'Different cause'}),reviewerModel:'mock'});
 assert.equal(result.pairsEvaluated,1);
 assert.equal(result.verifiedSameProblem,0);
 assert.equal(result.groups.length,2);
 assert.ok(calls.some(([sql])=>sql.startsWith('INSERT INTO corroboration_edges')));
});

test('reply support is deduplicated by account and never becomes independent threads',()=>{
 const a=node('a','root');const groups=compileCorroborationGroups([],[],[a]);
 const reports=[
  {observation_id:'a',author_key:'alice',verdict:'firsthand_same_problem'},
  {observation_id:'a',author_key:'alice',verdict:'firsthand_same_problem'},
  {observation_id:'a',author_key:'root',verdict:'firsthand_same_problem'},
  {observation_id:'a',author_key:'bob',verdict:'agreement_only'}
 ];
 const result=attachThreadSignals(groups,reports,[a]);
 assert.equal(result[0].threadFirsthandAccounts,1);
 assert.equal(result[0].threadAgreementAccounts,1);
 assert.equal(result[0].threadRepliesAreIndependentSources,false);
});

test('repeated pair review uses saved verdict and does not call the model again',async()=>{
 const a=node('x'),b=node('y');
 let calls=0,stored=null;
 const pool={query:async(sql,args)=>{
  if(sql===NEAREST_PAIRS_SQL)return {rows:[pair(a,b)]};
  if(sql.includes('SELECT run_id AS'))return {rows:[a,b]};
  if(sql.includes('FROM conversation_support s'))return {rows:[]};
  if(sql.startsWith('SELECT verdict,rationale FROM corroboration_edges'))return {rows:stored?[stored]:[]};
  if(sql.startsWith('INSERT INTO corroboration_edges')){stored={verdict:args[5],rationale:args[6]};return {rowCount:1};}
  throw Error('unexpected SQL');
 }};
 const opts={reviewerModel:'mock',judge:async()=>{calls++;return {verdict:'different_problem',rationale:'Distinct bugs'};}};
 const first=await runCorroboration(pool,opts);
 const second=await runCorroboration(pool,opts);
 assert.equal(first.cachedPairs,0);assert.equal(second.cachedPairs,1);assert.equal(calls,1);
});

test('scoped semantic comparison only examines pairs involving newly verified observations',async()=>{
 const {TARGETED_NEAREST_PAIRS_SQL}=await import('../packages/agents/corroborate.mjs');
 const a=node('a'),b=node('b');
 const calls=[];
 const pool={query:async(sql,params)=>{
  calls.push({sql,params});
  if(sql===TARGETED_NEAREST_PAIRS_SQL)return {rows:[pair(a,b)]};
  if(sql.includes('SELECT run_id AS'))return {rows:[a,b]};
  if(sql.includes('FROM conversation_support s'))return {rows:[]};
  if(sql.startsWith('SELECT verdict,rationale FROM corroboration_edges'))return {rows:[]};
  if(sql.startsWith('INSERT INTO corroboration_edges'))return {rowCount:1};
  throw Error('Unexpected query');
 }};
 const result=await runCorroboration(pool,{observationIds:['b'],threshold:0.5,maxPairs:3,reviewerModel:'test',judge:async()=>({verdict:'different_problem',rationale:'Different cause'})});
 assert.equal(result.pairsEvaluated,1);
 assert.equal(calls[0].sql,TARGETED_NEAREST_PAIRS_SQL);
 assert.deepEqual(calls[0].params[4],['b']);
 assert.match(calls[0].params[3],/same-problem-v2$/);
 assert.match(TARGETED_NEAREST_PAIRS_SQL,/a\.observation_id=ANY\(\$5::text\[\]\)/);
});

test('semantic retrieval never wastes comparison budget on same original thread and prioritizes unreviewed pairs',()=>{
 assert.match(NEAREST_PAIRS_SQL,/COALESCE\(a\.thread_root_id,a\.observation_id\)<>COALESCE\(b\.thread_root_id,b\.observation_id\)/);
 assert.match(NEAREST_PAIRS_SQL,/prior\.model=\$4/);
 assert.match(NEAREST_PAIRS_SQL,/CASE WHEN EXISTS/);
 assert.match(NEAREST_PAIRS_SQL,/THEN 1 ELSE 0 END/);
});
