import test from 'node:test';
import assert from 'node:assert/strict';
import {ANN_CANDIDATES_SQL,EXACT_CANDIDATES_SQL,compareKnnRecall,auditKnn} from '../packages/agents/knn-audit.mjs';
const pair=(a,b)=>({left_id:a,right_id:b});
test('KNN diagnostic measures missing exact candidates without calling a model',()=>{
 const exact=[pair('a','b'),pair('b','c'),pair('a','d')];
 const approx=[pair('b','a'),pair('a','d')];
 const r=compareKnnRecall(exact,approx,{topK:3});
 assert.equal(r.recallAtK,2/3);
 assert.deepEqual(r.missed,['b|c']);
 assert.equal(r.productionQueryChanged,false);
});
test('empty exact candidate set is reported as undefined recall, not 100 percent',()=>{
 const r=compareKnnRecall([],[],{topK:4});
 assert.equal(r.recallAtK,null);
 assert.equal(r.exactTop,0);
});
test('candidate queries require current source versions and distinct original threads',()=>{
 for(const sql of [ANN_CANDIDATES_SQL,EXACT_CANDIDATES_SQL]){
  assert.match(sql,/source_content_hash=o\.content_hash/);
  assert.match(sql,/thread_root_id/);
 }
 assert.match(ANN_CANDIDATES_SQL,/CROSS JOIN LATERAL/);
 assert.match(ANN_CANDIDATES_SQL,/ORDER BY near\.embedding <=> a\.embedding LIMIT \$3/);
});
test('audit enforces bounded queries and reports comparison coverage transparently',async()=>{
 const calls=[];
 const pool={query:async(sql,args)=>{
  calls.push({sql,args});
  return {rows:sql===EXACT_CANDIDATES_SQL?[pair('a','b'),pair('a','c')]:[pair('a','b')]};
 }};
 const result=await auditKnn(pool,{anchorLimit:4,neighbors:3,topK:2,threshold:0.2});
 assert.equal(result.recallAtK,.5);
 assert.equal(result.productionQueryChanged,false);
 assert.equal(calls.length,2);
 assert.deepEqual(calls[1].args,['all-minilm',4,3,.2,12]);
 await assert.rejects(auditKnn(pool,{anchorLimit:10000}),/bounds/);
});
