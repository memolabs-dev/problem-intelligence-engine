import test from 'node:test';
import assert from 'node:assert/strict';
import {rankNovelCrossDiscussionPairs,mineAlternateEmbeddingPairs,CURRENT_MINING_PROBLEMS_SQL,PREVIOUS_MINING_VERDICTS_SQL} from '../packages/agents/mine-alternate-pairs.mjs';
const row=(id,thread=id,source='github')=>({id,run_id:'run-'+id,statement:'A specific failure for '+id,
 source,url:source==='github'?'https://github.com/a/b/issues/'+id:'https://news.ycombinator.com/item?id='+id,
 thread_root_id:thread,reporter_key:'account-'+id});
test('rejects same-story comments, previously reviewed current snapshots, and caps pair exposure',()=>{
 const a=row('a','thread-one','hackernews'),b=row('b','thread-one','hackernews'),
 c=row('c','thread-two'),d=row('d','thread-three');
 const prior=[{left_observation:'a',left_run:'run-a',right_observation:'c',right_run:'run-c',verdict:'different_problem'}];
 const result=rankNovelCrossDiscussionPairs([a,b,c,d],[[1,0],[.99,.1],[.95,.15],[.9,.2]],prior,{limit:8,maxPerObservation:1,minSimilarity:-1});
 assert.ok(result.sameThreadSkipped>=1);
 assert.equal(result.alreadyReviewedSkipped,1);
 assert.equal(result.selected.length,2);
 assert.ok(!result.selected.some(x=>x.left.id==='a'&&x.right.id==='b'));
 assert.ok(result.selected.every(x=>x.semanticEquivalence==='unreviewed'));
 assert.ok(result.selected.every(x=>x.independentlyVerifiedHumans===null));
});
test('old verdicts for changed source versions do not block fresh candidates',()=>{
 const a=row('a'),b=row('b');
 const edges=[{left_observation:'a',left_run:'old-run',right_observation:'b',right_run:'run-b',verdict:'different_problem'}];
 const result=rankNovelCrossDiscussionPairs([a,b],[[1,0],[.9,.1]],edges,{minSimilarity:0.1});
 assert.equal(result.selected.length,1);
 assert.equal(result.alreadyReviewedSkipped,0);
});
test('live mining uses source-current SQL and local model without changing pgvector',async()=>{
 const calls=[];
 const a=row('a'),b=row('b','hackernews:thread','hackernews');
 const db={query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql===CURRENT_MINING_PROBLEMS_SQL)return {rows:[a,b]};
  if(sql===PREVIOUS_MINING_VERDICTS_SQL)return {rows:[]};
  throw Error('Unexpected query');
 }};
 const requested=[];
 const result=await mineAlternateEmbeddingPairs(db,{model:'nomic-embed-text',maxNodes:30,
  embed:async(text,{model})=>{requested.push({text,model});return text.includes('a')?[1,0]:[.8,.3];}});
 assert.equal(result.pairs.length,1);
 assert.equal(result.modelJudgmentsPerformed,0);
 assert.equal(result.productionEmbeddingsUnchanged,true);
 assert.equal(result.independentHoldout,false);
 assert.equal(requested.length,2);
 assert.ok(requested.every(x=>x.model==='nomic-embed-text'));
 assert.equal(calls[0].sql,CURRENT_MINING_PROBLEMS_SQL);
 assert.equal(calls[1].sql,PREVIOUS_MINING_VERDICTS_SQL);
 assert.equal(JSON.stringify(result).includes('account-a'),false);
});
test('mining rejects bad budgets and missing source-grounded inputs',async()=>{
 const a=row('a'),b=row('b');
 assert.throws(()=>rankNovelCrossDiscussionPairs([a,b],[[1,0]],[]),/Invalid mining/);
 await assert.rejects(mineAlternateEmbeddingPairs({}, {model:'https://somewhere',maxNodes:30}),/Invalid local/);
 const short=await mineAlternateEmbeddingPairs({query:async()=>({rows:[a]})},{maxNodes:10});
 assert.equal(short.pairs.length,0);
});

test('source-scoped hashes cannot prove distinct accounts across different platforms',()=>{
 const a=row('a','a','github'),b=row('b','b','hackernews');
 const result=rankNovelCrossDiscussionPairs([a,b],[[1,0],[1,0]],[],{minSimilarity:.2});
 assert.equal(result.selected[0].distinctSourceAccounts,null);
 assert.equal(result.selected[0].independentlyVerifiedHumans,null);
});
