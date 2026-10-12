import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateLLMReport} from '../packages/agents/evaluate-llm.mjs';
const labels=[{id:'p',problem:true},{id:'n',problem:false},{id:'u',problem:true}];
test('reports extraction quality separately from model failures',()=>{
 const result=evaluateLLMReport(labels,{results:[
  {observationId:'p',status:'found',candidate:{statement:'Failure detected',excerpt:'Verbatim proof'}},
  {observationId:'n',status:'none'},
  {observationId:'u',status:'error',error:'LLM output truncated'}
 ]});
 assert.deepEqual(result.status,{found:1,none:1,rejected:0,error:1});
 assert.equal(result.metrics.tp,1);
 assert.equal(result.metrics.tn,1);
 assert.equal(result.metrics.fn,0);
 assert.equal(result.metrics.missing,1);
 assert.equal(result.metrics.coverage,2/3);
 assert.ok(result.disagreements.some(x=>x.id==='u'&&x.status==='missing'));
});
test('never counts a failed inference as a true negative',()=>{
 const result=evaluateLLMReport([{id:'a',problem:false}],{results:[{observationId:'a',status:'error'}]});
 assert.equal(result.metrics.tn,0);
 assert.equal(result.metrics.coverage,0);
});
test('rejects duplicate predictions and claims without evidence',()=>{
 assert.throws(()=>evaluateLLMReport(labels,{results:[{observationId:'p',status:'none'},{observationId:'p',status:'none'}]}),/duplicate/);
 assert.throws(()=>evaluateLLMReport(labels,{results:[{observationId:'p',status:'found',candidate:{statement:'Unverified'}}]}),/validated candidate/);
});
