import test from 'node:test';
import assert from 'node:assert/strict';
import {batchExtractLLM} from '../packages/agents/batch-llm.mjs';
test('batch captures valid, empty, and failed extractions without aborting',async()=>{
 const rows=[{id:'a'},{id:'b'},{id:'c'}];let n=0;const emitted=[];
 const result=await batchExtractLLM({query:async()=>({rows})},{extract:async()=>{n++;if(n===1)return {statement:'ok'};if(n===2)return null;throw Error('bad quote')},onResult:r=>emitted.push(r)});
 assert.equal(result.total,3);assert.equal(result.found,1);assert.equal(result.none,1);assert.equal(result.error,1);assert.equal(emitted.length,3);assert.equal(result.results[2].error,'bad quote');
});
test('retries a bad evidence quote once and accepts only validated follow-up',async()=>{
 let attempts=0;const result=await batchExtractLLM({query:async()=>({rows:[{id:'a'}]})},{extract:async()=>{attempts++;if(attempts===1)throw Error('Evidence quote not present in observation');return {statement:'verified'}}});
 assert.equal(attempts,2);assert.equal(result.found,1);assert.equal(result.error,0);
});
test('does not retry unrelated errors',async()=>{
 let attempts=0;const result=await batchExtractLLM({query:async()=>({rows:[{id:'a'}]})},{extract:async()=>{attempts++;throw Error('LLM HTTP 429')}});
 assert.equal(attempts,1);assert.equal(result.error,1);
});
