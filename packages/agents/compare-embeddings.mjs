import {readFile,writeFile} from 'node:fs/promises';
import {evaluateEmbeddingRetrieval} from './evaluate-embeddings.mjs';

const LOCAL_MODEL=/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?$/i;
export function parseLocalModels(value){
 if(typeof value!=='string')throw Error('Expected comma-separated local model names');
 const models=[...new Set(value.split(',').map(x=>x.trim()))];
 if(models.length<2||models.length>4||models.some(x=>!LOCAL_MODEL.test(x)))throw Error('Compare 2–4 safe local embedding model names');
 return models;
}
/** Pairwise discrimination among synthetic examples. NOT a population AUC. */
export function pairwiseDevelopmentAUC(pairs){
 const positives=pairs.filter(x=>x.expected==='same_problem').map(x=>x.similarity);
 const negatives=pairs.filter(x=>x.expected==='different_problem').map(x=>x.similarity);
 if(!positives.length||!negatives.length)return null;
 let wins=0;
 for(const positive of positives)for(const negative of negatives)
  wins+=positive>negative?1:positive===negative?0.5:0;
 return wins/(positives.length*negatives.length);
}
export async function embedLocalComparisonText(text,{model,fetcher=fetch}={}){
 if(typeof text!=='string'||!text.trim()||!LOCAL_MODEL.test(model||''))throw Error('Invalid local embedding request');
 const response=await fetcher('http://127.0.0.1:11434/api/embed',{
  method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(45000),
  body:JSON.stringify({model,input:text})
 });
 if(!response.ok)throw Error('Local Ollama embedding HTTP '+response.status);
 const data=await response.json();
 const vector=data?.embeddings?.[0];
 if(!Array.isArray(vector)||vector.length<128||vector.length>4096||
  !vector.every(x=>typeof x==='number'&&Number.isFinite(x))||Math.hypot(...vector)<1e-12)
  throw Error('Invalid local embedding vector');
 return vector;
}
export async function compareLocalEmbeddings(cases,{models,embed=embedLocalComparisonText}={}){
 const names=Array.isArray(models)?parseLocalModels(models.join(',')):parseLocalModels(models);
 const results=[];
 for(const model of names){
  try{
   // An explicit per-call Ollama model selector. No production vectors are
   // overwritten; each model is scored independently on DEV-ONLY examples.
   const report=await evaluateEmbeddingRetrieval(cases,{model,embed:text=>embed(text,{model})});
   results.push({model,status:'ok',pairwiseDevAUC:pairwiseDevelopmentAUC(report.pairs),
    metrics:report.metrics,pairs:report.pairs});
  }catch(error){results.push({model,status:'error',error:String(error?.message||error).slice(0,180)});}
 }
 return {kind:'local_embedding_model_comparison',independentHoldout:false,
  productionModelUnchanged:true,source:'synthetic_development_pairs',
  results,caveat:'The model scores come from eight synthetic training/development examples. Do NOT use this to claim independently established retrieval accuracy or choose a production model without an annotated holdout.'};
}
if(process.argv[1]?.endsWith('/packages/agents/compare-embeddings.mjs')){
 const data=JSON.parse(await readFile(new URL('../../eval/corroboration-pairs.json',import.meta.url),'utf8'));
 if(data.kind!=='development_synthetic_cases'||data.independentHoldout!==false)throw Error('Only labeled development examples permitted');
 const models=parseLocalModels(process.env.PIE_EMBED_COMPARE_MODELS||'all-minilm,nomic-embed-text');
 const report=await compareLocalEmbeddings(data.cases,{models});
 const path=process.env.PIE_EMBED_COMPARE_REPORT_PATH;
 if(path)await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify(report,null,2));
 if(report.results.some(result=>result.status==='error'))process.exitCode=1;
}
