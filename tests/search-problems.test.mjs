import test from 'node:test';
import assert from 'node:assert/strict';
import {searchStoredProblems,normalizeNearestResults,SEARCH_STORED_PROBLEMS_SQL} from '../packages/agents/search-problems.mjs';

test('search is parameterized, bounded and follows current source fingerprints',async()=>{
 const expected=[
  {id:'github:1',statement:'CSV imports require full file buffering',excerpt:'Large CSV imports fail at 1 GB',source:'github',url:'https://github.com/a/b/issues/1',similarity:0.78},
  {id:'github:2',statement:'A completely unrelated router failure',excerpt:'Router fails to boot after reset',source:'github',url:'https://github.com/a/b/issues/2',similarity:0.08}
 ];
 let called=0;
 const pool={query:async(sql,params)=>{
  called++;
  assert.equal(sql,SEARCH_STORED_PROBLEMS_SQL);
  assert.match(sql,/ORDER BY e\.embedding <=> \$2::vector/);
  assert.match(sql,/md\.source_content_hash=o\.content_hash/);
  assert.deepEqual(params.slice(0,1),['all-minilm']);
  assert.equal(JSON.parse(params[1]).length,384);
  assert.equal(params[2],20);
  return {rows:expected};
 }};
 const result=await searchStoredProblems(pool,'Streaming large CSV imports fails due to buffer size',{embed:async()=>Array(384).fill(0.03),limit:2});
 assert.equal(called,1);
 assert.equal(result.matched,1);
 assert.equal(result.results[0].observationId,'github:1');
 assert.equal(result.results[0].commercialValidation,'unknown');
 assert.equal(result.results[0].sameUnderlyingProblem,'not_reviewed');
 assert.equal(result.results[0].similarity,0.78);
});
test('never promotes missing proofs or duplicate source IDs',()=>{
 const result=normalizeNearestResults([
  {id:'1',similarity:0.9,statement:'A source problem',excerpt:'An exact source proof',url:'https://example.org/1'},
  {id:'1',similarity:0.8,statement:'A duplicated source',excerpt:'Another quoted source',url:'https://example.org/1'},
  {id:'2',similarity:0.7,statement:'No excerpt',url:'https://example.org/2'}
 ],{minSimilarity:0.4});
 assert.equal(result.length,1);
});
test('search rejects invalid input without contacting embeddings service',async()=>{
 const pool={query:async()=>{throw Error('Should not hit db');}};
 let called=false;
 await assert.rejects(searchStoredProblems(pool,'too brief',{embed:async()=>{called=true;return Array(384).fill(1);}}),/Query must describe/);
 assert.equal(called,false);
 await assert.rejects(searchStoredProblems(pool,'An actual problem with input',{limit:999}),/Invalid nearest-neighbor/);
});
