import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLocalModels,pairwiseDevelopmentAUC,compareLocalEmbeddings,embedLocalComparisonText} from '../packages/agents/compare-embeddings.mjs';

test('model comparison accepts unique safe local Ollama model names only',()=>{
 assert.deepEqual(parseLocalModels('all-minilm, nomic-embed-text,all-minilm'),['all-minilm','nomic-embed-text']);
 assert.throws(()=>parseLocalModels('http://remote.example,all-minilm'),/safe local/);
 assert.throws(()=>parseLocalModels('all-minilm'),/Compare 2/);
 assert.throws(()=>parseLocalModels('a,b,c,d,e'),/Compare 2/);
});
test('pairwise dev AUC reports ranking only when both classes exist',()=>{
 assert.equal(pairwiseDevelopmentAUC([{expected:'same_problem',similarity:.5},{expected:'different_problem',similarity:.5}]),.5);
 assert.equal(pairwiseDevelopmentAUC([{expected:'same_problem',similarity:.7},{expected:'different_problem',similarity:.3}]),1);
 assert.equal(pairwiseDevelopmentAUC([{expected:'same_problem',similarity:.1},{expected:'different_problem',similarity:.3}]),0);
 assert.equal(pairwiseDevelopmentAUC([{expected:'same_problem',similarity:.7}]),null);
});
test('comparison uses each explicit Ollama model and never mutates the production embedding model',async()=>{
 const used=[];
 const report=await compareLocalEmbeddings([{id:'yes',expected:'same_problem',left:'A',right:'B'},
  {id:'no',expected:'different_problem',left:'A',right:'C'}],{
  models:['all-minilm','nomic-embed-text'],
  embed:async(text,{model})=>{used.push(model);return text==='C'?[0,1]:[1,0];}
 });
 assert.equal(report.independentHoldout,false);
 assert.equal(report.productionModelUnchanged,true);
 assert.deepEqual(report.results.map(x=>x.status),['ok','ok']);
 assert.deepEqual(new Set(used),new Set(['all-minilm','nomic-embed-text']));
 assert.equal(report.results[0].pairwiseDevAUC,1);
});
test('a model failure is recorded separately and does not become a negative pair',async()=>{
 const report=await compareLocalEmbeddings([{id:'yes',expected:'same_problem',left:'A',right:'B'}],{
  models:['good','missing'],embed:async(_text,{model})=>{if(model==='missing')throw Error('Model unavailable');return [1,0];}
 });
 assert.equal(report.results[0].status,'ok');
 assert.equal(report.results[1].status,'error');
 assert.match(report.results[1].error,/Model unavailable/);
 assert.equal(report.results[1].metrics,undefined);
});

test('comparison endpoint is loopback-only and accepts 768-dimensional vectors',async()=>{
 const observed=[];
 const vector=Array.from({length:768},(_,i)=>i===0?1:0);
 const result=await embedLocalComparisonText('Sample problem',{model:'nomic-embed-text',fetcher:async(url,options)=>{
  observed.push({url,model:JSON.parse(options.body).model});
  return {ok:true,json:async()=>({embeddings:[vector]})};
 }});
 assert.equal(result.length,768);
 assert.deepEqual(observed,[{url:'http://127.0.0.1:11434/api/embed',model:'nomic-embed-text'}]);
 await assert.rejects(embedLocalComparisonText('Sample problem',{model:'remote:model?bad'}),/Invalid local/);
});
