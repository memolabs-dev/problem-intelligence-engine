import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVerdict,verifyWithLLM,verifyReport} from '../packages/agents/verify.mjs';
const bug={id:'github:bug',title:'Uploads fail for large files',body:'Uploads fail after two minutes.',url:'https://github.com/example/x/issues/1'};
const candidate={statement:'Large file uploads fail after two minutes',excerpt:bug.title};
test('rejects contradictory or malformed verification labels',()=>{
 assert.deepEqual(validateVerdict({accept:true,category:'observed_failure'}),{accept:true,category:'observed_failure'});
 assert.throws(()=>validateVerdict({accept:true,category:'generic_question'}),/Inconsistent/);
 assert.throws(()=>validateVerdict({accept:'yes',category:'observed_failure'}),/Invalid/);
});
test('rejects explicit spam locally without calling a model',async()=>{
 let called=false;
 const result=await verifyWithLLM({id:'s',title:'[SPAM]',body:'const express = require("express")',url:'https://example.org'},{statement:'This code might contain a bug',excerpt:'const express = require("express")'},{env:{PIE_LLM_PROVIDER:'openrouter',OPENROUTER_API_KEY:'mock'},fetcher:async()=>{called=true;}});
 assert.equal(result.accept,false);assert.equal(result.category,'spam');assert.equal(called,false);
});
test('rejects claims without exact quoted evidence',async()=>{
 await assert.rejects(verifyWithLLM(bug,{statement:'Some claim',excerpt:'An invented quote'},{env:{PIE_LLM_PROVIDER:'openrouter',OPENROUTER_API_KEY:'mock'}}),/not grounded/);
});
test('reviewer sends Nemotron-compatible request and respects semantic rejection',async()=>{
 let request;
 const result=await verifyWithLLM(bug,candidate,{env:{PIE_LLM_PROVIDER:'openrouter',PIE_LLM_MODEL:'nvidia/nemotron-3.5-lightning:free',OPENROUTER_API_KEY:'mock'},fetcher:async(_url,opts)=>{request=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"accept":false,"category":"unsupported"}'}}]})}}});
 assert.equal(request.response_format,undefined);assert.equal(request.reasoning.effort,'none');assert.equal(result.accept,false);
});
test('verification distinguishes rejected candidates from service failures',async()=>{
 const report={results:[
  {observationId:'a',status:'found',candidate:{statement:'A',excerpt:'evidence'}},
  {observationId:'b',status:'found',candidate:{statement:'B',excerpt:'evidence'}},
  {observationId:'c',status:'none'}]};
 const pool={query:async()=>({rows:[{id:'a',title:'evidence',body:''},{id:'b',title:'evidence',body:''}]})};
 const verified=await verifyReport(pool,report,{judge:async(observation)=>{if(observation.id==='a')return {accept:false,category:'unsupported'};throw Error('Backend unavailable')}});
 assert.deepEqual([verified.found,verified.rejected,verified.none,verified.error],[0,1,1,1]);
});


test('reviewer retries a 429 once with a bounded delay',async()=>{
 let count=0;const delays=[];
 const pool={query:async()=>({rows:[{id:'a',title:'A task fails',body:'A task fails repeatedly.'}]})};
 const report={results:[{observationId:'a',status:'found',candidate:{statement:'Repeated failure',excerpt:'A task fails'}}]};
 const verified=await verifyReport(pool,report,{judge:async()=>{count++;if(count===1){const err=new Error('Reviewer HTTP 429');err.status=429;err.retryAfter='0';throw err;}return {accept:true,category:'observed_failure'};},sleeper:async delay=>delays.push(delay)});
 assert.equal(count,2);assert.deepEqual(delays,[15000]);assert.equal(verified.found,1);assert.equal(verified.error,0);
});


test('forced Nemotron reviewer accepts valid structured verdict',async()=>{
 let sent;
 const result=await verifyWithLLM(bug,candidate,{env:{PIE_LLM_PROVIDER:'openrouter',PIE_LLM_MODEL:'nvidia/nemotron-3.5-lightning:free',OPENROUTER_API_KEY:'mock'},fetcher:async(_url,opts)=>{
  sent=JSON.parse(opts.body);
  return {ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{function:{name:'submit_verdict',arguments:'{"accept":true,"category":"observed_failure"}'}}]}}]})};
 }});
 assert.equal(sent.tool_choice.function.name,'submit_verdict');assert.equal(sent.response_format,undefined);
 assert.deepEqual({accept:result.accept,category:result.category},{accept:true,category:'observed_failure'});
});
