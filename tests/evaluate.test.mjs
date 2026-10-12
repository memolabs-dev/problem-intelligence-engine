import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePredictions} from '../packages/agents/evaluate.mjs';
test('reports precision recall and false positives without dropping missing observations',()=>{
 const result=evaluatePredictions([{id:'a',problem:true},{id:'b',problem:true},{id:'c',problem:false},{id:'d',problem:false},{id:'e',problem:true}],{a:true,b:false,c:true,d:false});
 assert.deepEqual([result.tp,result.fp,result.tn,result.fn,result.missing],[1,1,1,1,1]);
 assert.equal(result.precision,0.5);assert.equal(result.recall,0.5);assert.equal(result.coverage,0.8);
});
test('unknown precision and recall are not misleading zeros',()=>{
 const result=evaluatePredictions([{id:'a',problem:false}],{a:false});
 assert.equal(result.precision,null);assert.equal(result.recall,null);
});

test('rejects empty, duplicate, and ambiguous labels',()=>{
 assert.throws(()=>evaluatePredictions([],{}),/Nonempty/);
 assert.throws(()=>evaluatePredictions([{id:'x',problem:true},{id:'x',problem:false}],{}),/duplicate/);
 assert.throws(()=>evaluatePredictions([{id:'x',problem:'yes'}],{}),/Invalid/);
});
test('extractor comparison keeps identical denominator',async()=>{
 const {compareExtractors}=await import('../packages/agents/evaluate.mjs');
 const labels=[{id:'a',problem:true},{id:'b',problem:false}];
 const observations=[{id:'a'},{id:'b'}];
 const result=compareExtractors(labels,observations,{strict:o=>o.id==='a',loose:()=>true});
 assert.equal(result.strict.fp,0);assert.equal(result.loose.fp,1);
 assert.equal(result.strict.coverage,result.loose.coverage);
});

test('hard-case benchmark exposes implicit problems and superficial keyword false positives',async()=>{
 const {extractProblem}=await import('../packages/agents/extract.mjs');
 const cases=[
  {id:'implicit',problem:true,title:'Every invoice takes three manual spreadsheet transfers',body:'Our team copies data between systems every morning because there is no integration.'},
  {id:'negated',problem:false,title:'No error occurred in the release',body:'Everything works correctly and the migration is complete.'},
  {id:'quoted',problem:false,title:'Documentation about error handling',body:'The guide explains what an error is, but nobody reports a failure.'},
  {id:'explicit',problem:true,title:'Upload fails for files over 5GB',body:'Every upload fails at 99 percent.'},
  {id:'question',problem:false,title:'Ask HN: What is your favorite IDE?',body:'I need a recommendation for my class.'}
 ];
 const observations=cases.map(({id,title,body})=>({id,title,body,url:'https://example.com/'+id}));
 const labels=cases.map(({id,problem})=>({id,problem}));
 const {compareExtractors}=await import('../packages/agents/evaluate.mjs');
 const result=compareExtractors(labels,observations,{heuristic:extractProblem}).heuristic;
 assert.equal(result.tp+result.fp+result.tn+result.fn,5);
 assert.ok(result.details.some(x=>x.id==='implicit'&&x.status==='tp'),'implicit operational pain should now be detected');
});
