import {createPool} from '../storage/postgres.mjs';
import {extractWithLLM,resolveLLMConfig} from './llm.mjs';
import {writeFile} from 'node:fs/promises';

export async function batchExtractLLM(pool,{limit=10,extract=extractWithLLM,onResult=()=>{}}={}){
 const {rows}=await pool.query('SELECT id,title,body,url FROM observations ORDER BY id LIMIT $1',[limit]);
 const results=[];
 for(const row of rows){
  const started=Date.now();
  let result;
  try{const extracted=await extract(row);result={observationId:row.id,status:extracted?'found':'none',...(extracted?{candidate:extracted}:{})};}
  catch(error){result={observationId:row.id,status:'error',error:error?.name==='TimeoutError'?'timeout':String(error?.message||error).slice(0,200)};}
  result.elapsedMs=Date.now()-started;results.push(result);onResult(result);
 }
 const counts={found:0,none:0,error:0};for(const result of results)counts[result.status]++;
 return {total:rows.length,...counts,results};
}
if(process.argv[1]?.endsWith('/packages/agents/batch-llm.mjs')){
 const pool=createPool();try{
  const config=resolveLLMConfig();
  if(config.provider!=='openrouter'||!config.model.endsWith(':free'))throw Error('Batch only permits free OpenRouter models');
  const report=await batchExtractLLM(pool,{limit:Number(process.env.PIE_LLM_BATCH_LIMIT||10),onResult:r=>console.log(JSON.stringify(r))});
  const path=process.env.PIE_LLM_REPORT_PATH||'llm-batch-report.json';await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log('SUMMARY',JSON.stringify({total:report.total,found:report.found,none:report.none,error:report.error,path}));
  if(report.error)process.exitCode=1;
 }finally{await pool.end()}
}
