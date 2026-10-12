import {createPool} from '../storage/postgres.mjs';
import {extractWithLLM,resolveLLMConfig} from './llm.mjs';
import {writeFile} from 'node:fs/promises';
import {verifyReport} from './verify.mjs';
import {buildStoredEvidenceGraph} from './evidence-graph.mjs';
import {selectForLLM} from './select.mjs';
import {extractProblem} from './extract.mjs';

export async function batchExtractLLM(pool,{limit=10,observationIds=null,extract=extractWithLLM,onResult=()=>{},fallback=null}={}){
 if(!Number.isInteger(limit)||limit<1||limit>500)throw new RangeError('Invalid LLM batch limit');
 if(observationIds!==null&&(!Array.isArray(observationIds)||observationIds.length>500||observationIds.some(x=>typeof x!=='string'||!x.trim())))throw new Error('Invalid explicit observation IDs');
 const selectedIds=observationIds!==null?[...new Set(observationIds)].slice(0,limit):(process.env.PIE_LLM_OBSERVATION_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
 const strategy=process.env.PIE_LLM_SELECTION||'recent';
 let rows;
 if(observationIds!==null && selectedIds.length===0){
  rows=[];
 }else if(selectedIds.length){
  ({rows}=await pool.query('SELECT id,title,body,url,content_hash FROM observations WHERE id = ANY($1::text[]) ORDER BY id',[selectedIds]));
 }else if(strategy==='balanced'){
  const population=(await pool.query('SELECT id,title,body,url,content_hash FROM observations ORDER BY ingested_at DESC,id LIMIT $1',[Math.min(500,Math.max(limit*20,100))])).rows;
  const sample=selectForLLM(population,{limit,explorationFraction:Number(process.env.PIE_LLM_EXPLORATION_FRACTION||0.3)});
  rows=sample.rows;
  console.log(JSON.stringify({event:'sample_selected',strategy,stats:sample.stats}));
 }else if(strategy==='recent'){
  ({rows}=await pool.query('SELECT id,title,body,url,content_hash FROM observations ORDER BY published_at DESC NULLS LAST, id DESC LIMIT $1',[limit]));
 }else throw Error('Unknown PIE_LLM_SELECTION');

 const results=[];
 const batchStarted=Date.now();
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const retryable=error=>[429,502,503,504].includes(error?.status)||error?.name==='TimeoutError';
 const runWithRetry=async(row,options={})=>{let lastError;for(let attempt=1;attempt<=2;attempt++){try{return await extract(row,options);}catch(error){lastError=error;if(!retryable(error)||attempt===2)throw error;const parsed=Number(error.retryAfter);const delay=Number.isFinite(parsed)&&parsed>0?Math.min(parsed*1000,60000):(error.status===429&&extract===extractWithLLM?15000:2000);console.log(JSON.stringify({event:'network_retry',observationId:row.id,attempt,status:error.status||'timeout',delayMs:delay}));await sleep(delay);}}throw lastError;};
 console.log(JSON.stringify({event:'batch_started',total:rows.length,at:new Date().toISOString()}));
 for(const [index,row] of rows.entries()){
  console.log(JSON.stringify({event:'observation_started',index:index+1,total:rows.length,observationId:row.id,at:new Date().toISOString()}));
  const started=Date.now();
  let result;
  try{let extracted;try{extracted=await runWithRetry(row)}catch(error){const code=error?.code;const validatable=/Evidence quote not present in observation|Evidence ID and quote mismatch|Invalid problem statement|Invalid evidence quote|Missing LLM content/.test(String(error?.message));if(!validatable&&!['LLM_OUTPUT_TRUNCATED','LLM_MISSING_CONTENT','LLM_INVALID_JSON'].includes(code))throw error;const isTruncated=code==='LLM_OUTPUT_TRUNCATED';extracted=await runWithRetry(row,{retryFeedback:String(error?.message||error),...(isTruncated?{maxTokens:6144,reasoningEffort:'none',timeoutMs:150000}:{})});}result={observationId:row.id,status:extracted?'found':'none',...(extracted?{candidate:extracted}:{})};}
  catch(error){
   const modelError=String(error?.message||error).slice(0,200);
   // Fallback is for invalid model output, never for transport failures or no-problem decisions.
   const recoverable=/^(Invalid problem statement|Invalid evidence quote|Evidence quote not present in observation|Evidence ID and quote mismatch|Invalid LLM JSON output|Missing LLM content)/.test(modelError);
   let candidate=null;
   if(typeof fallback==='function'&&recoverable)candidate=fallback(row);
   result=candidate?{observationId:row.id,status:'found',candidate,recovery:{kind:'heuristic_fallback',modelError}}:{observationId:row.id,status:'error',error:error?.name==='TimeoutError'?'timeout':modelError};
  }
  result.sourceContentHash=row.content_hash?.trim()||null;
  result.elapsedMs=Date.now()-started;results.push(result);onResult(result);console.log(JSON.stringify({event:'progress',completed:results.length,total:rows.length,found:results.filter(r=>r.status==='found').length,none:results.filter(r=>r.status==='none').length,error:results.filter(r=>r.status==='error').length,elapsedMs:Date.now()-batchStarted,observationId:row.id,status:result.status}));
 }
 const counts={found:0,none:0,error:0};for(const result of results)counts[result.status]++;
 return {total:rows.length,...counts,recovered:results.filter(r=>r.recovery?.kind==='heuristic_fallback').length,results};
}
export async function verifiedBatchExtractLLM(pool,options={}){
 const raw=await batchExtractLLM(pool,{...options,fallback:options.fallback??(process.env.PIE_LLM_FALLBACK==='heuristic'?extractProblem:null)});
 const verified=await verifyReport(pool,raw,{judge:options.judge});
 verified.evidenceGraph=await buildStoredEvidenceGraph(pool,verified);
 return {raw,verified};
}
if(process.argv[1]?.endsWith('/packages/agents/batch-llm.mjs')){
 const pool=createPool();try{
  const config=resolveLLMConfig();
  if(config.provider!=='nvidia' && !(config.provider==='openrouter' && config.model.endsWith(':free')))throw Error('Batch requires NVIDIA or a free OpenRouter model');
  if(!config.apiKey)throw Error('No API key available for '+config.provider+'; no requests sent');
  const verify=process.env.PIE_LLM_VERIFY==='1';
  const {raw,verified}=verify ? await verifiedBatchExtractLLM(pool,{limit:Number(process.env.PIE_LLM_BATCH_LIMIT||10),onResult:r=>console.log(JSON.stringify(r))}) : {raw:await batchExtractLLM(pool,{limit:Number(process.env.PIE_LLM_BATCH_LIMIT||10),onResult:r=>console.log(JSON.stringify(r))})};
  const report=verify?verified:raw;
  const path=process.env.PIE_LLM_REPORT_PATH||'llm-batch-report.json';await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log('SUMMARY',JSON.stringify({verified:verify,total:report.total,rawFound:raw.found,recovered:raw.recovered,found:report.found,rejected:report.rejected||0,none:report.none,error:report.error,path}));
  if(report.error)process.exitCode=1;
 }finally{await pool.end()}
}
