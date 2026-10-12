import test from 'node:test';
import assert from 'node:assert/strict';
import {commentPassages,validateCommentSupport,reviewCommentSupport,reviewThreadComments,COMMENTS_FOR_REVIEW_SQL} from '../packages/agents/comment-support.mjs';
test('a first-hand corroboration requires a source-exact excerpt',()=>{
 const passages=commentPassages('Our project encountered the same failure on large files. We applied a workaround.');
 assert.ok(passages.length);
 const v=validateCommentSupport({verdict:'firsthand_same_problem',quoteId:1},passages);
 assert.ok(v.excerpt.includes('same failure'));
 assert.throws(()=>validateCommentSupport({verdict:'firsthand_same_problem',quoteId:999},passages),/not grounded/);
 assert.equal(validateCommentSupport({verdict:'irrelevant',quoteId:0},passages).excerpt,null);
});
test('Nemotron comment reviewer uses a structured tool and never invents a quote',async()=>{
 let request;
 const row={statement:'CSV ingestion fails with large files',excerpt:'Ingestion fails after upload.',body:'Our app fails too when the CSV is larger than 1 GB.'};
 const verdict=await reviewCommentSupport(row,{
  env:{PIE_LLM_PROVIDER:'openrouter',PIE_LLM_MODEL:'nvidia/nemotron-3.5-lightning:free',OPENROUTER_API_KEY:'mock'},
  fetcher:async(_url,opts)=>{
   request=JSON.parse(opts.body);
   return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'submit_comment_support',arguments:'{"verdict":"firsthand_same_problem","quoteId":1}'}}]}}]})};
  }
 });
 assert.equal(request.tool_choice.function.name,'submit_comment_support');
 assert.equal(verdict.verdict,'firsthand_same_problem');
 assert.equal(verdict.excerpt,row.body);
});
test('same account in multiple comments counts only once, generic agreement stays separate',async()=>{
 const root='github:1';
 const rows=[
  {run_id:'run',observation_id:root,message_id:'m1',statement:'A specific failure',excerpt:'Root fails',body:'I reproduced this issue',author_key:'same'},
  {run_id:'run',observation_id:root,message_id:'m2',statement:'A specific failure',excerpt:'Root fails',body:'It still fails for me',author_key:'same'}
 ];
 const queries=[];
 const pool={query:async(sql,args)=>{
  queries.push(sql);
  if(sql===COMMENTS_FOR_REVIEW_SQL)return {rows};
  if(sql.includes('FROM conversation_support s'))return {rows:[{observation_id:root,firsthand_accounts:1,agreement_accounts:0,errors:0}]};
  return {rowCount:1};
 }};
 const result=await reviewThreadComments(pool,{review:async()=>({verdict:'firsthand_same_problem',excerpt:'I reproduced this issue'}),limit:3});
 assert.equal(result.reviewed,2);
 assert.equal(result.threadAccountSignals[0].firsthand_accounts,1);
 assert.equal(queries.filter(q=>q.startsWith('INSERT INTO conversation_support')).length,2);
});

test('links, suggestions, and positive solutions are not firsthand failures',async()=>{
 const {applyWitnessGate}=await import('../packages/agents/comment-support.mjs');
 assert.equal(applyWitnessGate('firsthand_same_problem','Maybe try a spectrogram model instead.'),'uncertain');
 assert.equal(applyWitnessGate('firsthand_same_problem','I have had good luck solving this with a tool.'),'uncertain');
 assert.equal(applyWitnessGate('firsthand_same_problem','Our application fails too when processing audio files.'),'firsthand_same_problem');
 assert.equal(applyWitnessGate('agreement_only','You might try another model.'),'uncertain');
 assert.equal(applyWitnessGate('agreement_only','Same here, agreed.'),'agreement_only');
});
