import test from 'node:test';
import assert from 'node:assert/strict';
import {extractWithLLM,validateExtraction} from '../packages/agents/llm.mjs';
const observation={id:'github:1',url:'https://github.com/example/project/issues/1',title:'CSV parsing fails on large files',body:'We need to split the file manually.'};
test('validates grounded LLM extraction',()=>{const result=validateExtraction({problem:{statement:'Large CSV parsing fails in the app',evidenceQuote:'CSV parsing fails on large files',userSegment:null,workaround:null,paymentEvidence:null}},observation);assert.equal(result.observationId,observation.id);assert.equal(result.paymentEvidence,null)});
test('rejects invented evidence',()=>assert.throws(()=>validateExtraction({problem:{statement:'Large CSV parsing fails',evidenceQuote:'People will pay 500 dollars'}},observation),/Evidence quote/));
test('supports no-problem output',()=>assert.equal(validateExtraction({problem:null},observation),null));
test('does not call paid API without credentials',async()=>{let called=false;await assert.rejects(extractWithLLM(observation,{apiKey:'',fetcher:async()=>{called=true}}),/required/);assert.equal(called,false)});
test('uses mocked LLM and validates its response',async()=>{const result=await extractWithLLM(observation,{apiKey:'test',fetcher:async(url,opts)=>{assert.match(opts.body,/json_object/);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({problem:{statement:'Large CSV parsing fails',evidenceQuote:observation.title}})}}]})}}});assert.equal(result.method,'llm-v1')});
