import test from 'node:test';
import assert from 'node:assert/strict';
import {cosineSimilarity,summarizeRetrievalScores,evaluateEmbeddingRetrieval} from '../packages/agents/evaluate-embeddings.mjs';

test('cosine comparison validates size, finite components and zero norms',()=>{
 assert.equal(cosineSimilarity([1,0],[1,0]),1);
 assert.equal(cosineSimilarity([1,0],[0,1]),0);
 assert.equal(cosineSimilarity([1,0],[-1,0]),-1);
 assert.throws(()=>cosineSimilarity([1,0],[1]),/Invalid comparable/);
 assert.throws(()=>cosineSimilarity([0,0],[1,0]),/zero-norm/);
});
test('developer diagnostic catches similarity overlap and threshold false merges',()=>{
 const s=summarizeRetrievalScores([
  {id:'p1',expected:'same_problem',similarity:.45},
  {id:'p2',expected:'same_problem',similarity:.78},
  {id:'n1',expected:'different_problem',similarity:.57},
  {id:'n2',expected:'different_problem',similarity:.10}
 ]);
 assert.equal(s.similarityOverlap,true);
 const cutoff=s.thresholdStats.find(x=>x.threshold===.5);
 assert.deepEqual([cutoff.tp,cutoff.fp,cutoff.fn,cutoff.tn],[1,1,1,1]);
 assert.equal(cutoff.precision,.5);
 assert.equal(cutoff.recall,.5);
});
test('no invented precision or recall when there are no predictions',()=>{
 const data=summarizeRetrievalScores([{id:'n',expected:'different_problem',similarity:.1}],{thresholds:[.6]});
 assert.equal(data.thresholdStats[0].precision,null);
 assert.equal(data.thresholdStats[0].recall,null);
});
test('mocked embedding evaluation never claims an independent benchmark',async()=>{
 const vectors=new Map([['Problem A',[1,0]],['Paraphrase B',[1,0]],['Different C',[0,1]]]);
 const result=await evaluateEmbeddingRetrieval([{id:'similar',expected:'same_problem',left:'Problem A',right:'Paraphrase B'},{id:'other',expected:'different_problem',left:'Problem A',right:'Different C'}],{embed:async text=>vectors.get(text),model:'test-local'});
 assert.equal(result.metrics.positiveExamples,1);
 assert.equal(result.independentHoldout,false);
 assert.equal(result.marketDemandValidated,false);
 assert.equal(result.pairs[0].similarity,1);
});
