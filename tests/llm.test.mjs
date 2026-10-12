import test from 'node:test';
import assert from 'node:assert/strict';
import {extractWithLLM,validateExtraction,resolveLLMConfig} from '../packages/agents/llm.mjs';
const observation={id:'github:1',url:'https://github.com/example/project/issues/1',title:'CSV parsing fails on large files',body:'We need to split the file manually.'};
test('validates grounded LLM extraction',()=>{const result=validateExtraction({problem:{statement:'Large CSV parsing fails in the app',evidenceQuote:'CSV parsing fails on large files',userSegment:null,workaround:null,paymentEvidence:null}},observation);assert.equal(result.observationId,observation.id);assert.equal(result.paymentEvidence,null)});
test('rejects invented evidence',()=>assert.throws(()=>validateExtraction({problem:{statement:'Large CSV parsing fails',evidenceQuote:'People will pay 500 dollars'}},observation),/Evidence quote/));
test('supports no-problem output',()=>assert.equal(validateExtraction({problem:null},observation),null));
test('does not call paid API without credentials',async()=>{let called=false;await assert.rejects(extractWithLLM(observation,{apiKey:'',fetcher:async()=>{called=true}}),/required/);assert.equal(called,false)});
test('uses mocked LLM and validates its response',async()=>{const result=await extractWithLLM(observation,{apiKey:'test',fetcher:async(url,opts)=>{assert.match(opts.body,/json_object/);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({problem:{statement:'Large CSV parsing fails',evidenceQuote:observation.title}})}}]})}}});assert.equal(result.method,'llm-v1')});
test('defaults to the openai provider config',()=>{const c=resolveLLMConfig({OPENAI_API_KEY:'k'});assert.equal(c.provider,'openai');assert.equal(c.endpoint,'https://api.openai.com/v1/chat/completions');assert.equal(c.model,'gpt-4.1-mini');assert.equal(c.apiKey,'k')});
test('resolves openrouter from its own key var',()=>{const c=resolveLLMConfig({PIE_LLM_PROVIDER:'openrouter',OPENROUTER_API_KEY:'sk-or'});assert.equal(c.endpoint,'https://openrouter.ai/api/v1/chat/completions');assert.equal(c.apiKey,'sk-or');assert.equal(c.model,'nvidia/nemotron-3.5-lightning:free')});
test('explicit PIE_LLM_API_KEY wins over the provider key var',()=>{const c=resolveLLMConfig({PIE_LLM_PROVIDER:'openrouter',PIE_LLM_API_KEY:'explicit',OPENROUTER_API_KEY:'fromVar'});assert.equal(c.apiKey,'explicit')});
test('PIE_LLM_BASE_URL and PIE_LLM_MODEL override provider presets',()=>{const c=resolveLLMConfig({PIE_LLM_PROVIDER:'custom',PIE_LLM_API_KEY:'k',PIE_LLM_BASE_URL:'https://llm.internal/v1/chat/completions',PIE_LLM_MODEL:'my-model'});assert.equal(c.endpoint,'https://llm.internal/v1/chat/completions');assert.equal(c.model,'my-model')});
test('rejects an unknown provider',()=>assert.throws(()=>resolveLLMConfig({PIE_LLM_PROVIDER:'jev'}),/Unknown PIE_LLM_PROVIDER/));
test('rejects custom provider without base URL',()=>assert.throws(()=>resolveLLMConfig({PIE_LLM_PROVIDER:'custom',PIE_LLM_API_KEY:'k'}),/PIE_LLM_BASE_URL is required/));
test('rejects custom provider without model',()=>assert.throws(()=>resolveLLMConfig({PIE_LLM_PROVIDER:'custom',PIE_LLM_API_KEY:'k',PIE_LLM_BASE_URL:'https://x.example/v1/chat/completions'}),/PIE_LLM_MODEL is required/));
test('never falls back to env when an explicit empty key is passed',async()=>{let called=false;await assert.rejects(extractWithLLM(observation,{apiKey:'',env:{OPENAI_API_KEY:'leaked',PIE_LLM_PROVIDER:'openai'},fetcher:async()=>{called=true}}),/required/);assert.equal(called,false)});
test('uses env-resolved provider endpoint and key',async()=>{let seen;const result=await extractWithLLM(observation,{env:{PIE_LLM_PROVIDER:'openrouter',OPENROUTER_API_KEY:'sk-or'},fetcher:async(url,opts)=>{seen={url,auth:opts.headers.Authorization};return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({problem:{statement:'Large CSV parsing fails',evidenceQuote:observation.title}})}}]})}}});assert.equal(seen.url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(seen.auth,'Bearer sk-or');assert.equal(result.method,'llm-v1')});

test('blocks paid OpenRouter models before making a request',async()=>{let called=false;await assert.rejects(extractWithLLM(observation,{env:{PIE_LLM_PROVIDER:'openrouter',OPENROUTER_API_KEY:'fake',PIE_LLM_MODEL:'openai/gpt-4.1-mini'},fetcher:async()=>{called=true}}),/must end in :free/);assert.equal(called,false)});

test('empty reasoning response reports finish reason',async()=>{await assert.rejects(extractWithLLM(observation,{apiKey:'test',fetcher:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:null,reasoning:'thinking'}}]})})}),/finish_reason=length/)});

test('numbered evidence rejects mismatched quote without an API call',async()=>{
 const {evidencePassages}=await import('../packages/agents/llm.mjs');
 const passages=evidencePassages(observation);assert.ok(passages.length);
 const resolved=validateExtraction({problem:{statement:'Large CSV parsing fails in the app',evidenceId:1,evidenceQuote:'We need to split the file manually.'}},observation);assert.equal(resolved.excerpt,passages[0].quote);
 assert.throws(()=>validateExtraction({problem:{statement:'Large CSV parsing fails in the app',evidenceId:999}},observation),/Evidence ID and quote mismatch/);
 const valid=validateExtraction({problem:{statement:'Large CSV parsing fails in the app',evidenceId:1,evidenceQuote:passages[0].quote}},observation);assert.equal(valid.excerpt,passages[0].quote);
});


test('Nemotron requests suppress unsupported response_format and cap reasoning',async()=>{
 let sent;
 const result=await extractWithLLM(observation,{env:{PIE_LLM_PROVIDER:'openrouter',PIE_LLM_MODEL:'nvidia/nemotron-3.5-lightning:free',OPENROUTER_API_KEY:'mock'},fetcher:async(_url,opts)=>{sent=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"problem":{"statement":"Parsing CSV files fails for large uploads","evidenceId":1}}'}}]})}}});
 assert.equal(sent.model,'nvidia/nemotron-3.5-lightning:free');
 assert.equal(sent.response_format,undefined);
 assert.equal(sent.reasoning.effort,'none');
 assert.equal(sent.max_tokens,4096);
 assert.equal(result.excerpt,observation.title);
});
test('detects reasoning exhaustion without mistaking it for a valid empty problem',async()=>{
 await assert.rejects(extractWithLLM(observation,{apiKey:'mock',fetcher:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:null,reasoning:'not exposed'}}],usage:{completion_tokens_details:{reasoning_tokens:2400}}})})}),err=>err.code==='LLM_OUTPUT_TRUNCATED'&&err.reasoningTokens===2400);
});
test('rejects non-JSON content with recoverable typed error',async()=>{
 await assert.rejects(extractWithLLM(observation,{apiKey:'mock',fetcher:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'not json'}}]})})}),err=>err.code==='LLM_INVALID_JSON');
});


test('forced Nemotron tool call resolves a source-linked evidenceId',async()=>{
 let sent;
 const result=await extractWithLLM(observation,{env:{PIE_LLM_PROVIDER:'openrouter',OPENROUTER_API_KEY:'mock',PIE_LLM_MODEL:'nvidia/nemotron-3.5-lightning:free'},fetcher:async(_url,opts)=>{
  sent=JSON.parse(opts.body);
  return {ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{function:{name:'submit_extraction',arguments:JSON.stringify({has_problem:true,statement:'Large CSV uploads fail in the application',evidenceId:1})}}]}}]})};
 }});
 assert.equal(sent.tool_choice.function.name,'submit_extraction');assert.equal(sent.response_format,undefined);
 assert.equal(result.excerpt,observation.title);
});
test('forced Nemotron tool explicitly supports no problem',async()=>{
 const result=await extractWithLLM(observation,{env:{PIE_LLM_PROVIDER:'openrouter',OPENROUTER_API_KEY:'mock',PIE_LLM_MODEL:'nvidia/nemotron-3.5-lightning:free'},fetcher:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'submit_extraction',arguments:'{"has_problem":false,"statement":"","evidenceId":0}'}}]}}]})})});
 assert.equal(result,null);
});
test('forced tool with invented evidenceId still fails grounding',async()=>{
 await assert.rejects(extractWithLLM(observation,{env:{PIE_LLM_PROVIDER:'openrouter',OPENROUTER_API_KEY:'mock',PIE_LLM_MODEL:'nvidia/nemotron-3.5-lightning:free'},fetcher:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'submit_extraction',arguments:'{"has_problem":true,"statement":"Large files break uploading workflows","evidenceId":999}'}}]}}]})})}),/Evidence ID and quote mismatch/);
});


test('rejects evidence identifiers omitted from the model prompt',()=>{
 const huge={id:'long',url:'https://example.org',title:'A source title describing a concrete problem',body:Array.from({length:90},(_,i)=>'Observation sentence '+i+' is a complete distinct source statement.').join(' ')};
 assert.throws(()=>validateExtraction({problem:{statement:'A concrete problem described by the source',evidenceId:81}},huge),/Evidence ID and quote mismatch/);
 const longQuote={id:'long-quote',url:'https://example.org',title:'A'.repeat(510),body:''};
 assert.throws(()=>validateExtraction({problem:{statement:'A concrete problem in source body',evidenceId:1}},longQuote),/Evidence ID and quote mismatch/);
});
