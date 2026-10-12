import {readFile,writeFile} from 'node:fs/promises';
import {verifyProblemPair} from './corroborate.mjs';

export function measurePairQuality(cases,results){
 if(!Array.isArray(cases)||!cases.length)throw Error('No labeled pairs');
 const labels=new Map(cases.map(c=>[c.id,c.expected]));
 if(labels.size!==cases.length||cases.some(c=>!['same_problem','different_problem'].includes(c.expected)))throw Error('Invalid or duplicate pair labels');
 const predictions=new Map(results.map(r=>[r.id,r.verdict]));
 const counts={tp:0,fp:0,tn:0,fn:0,unresolved:0};
 for(const item of cases){
  const predicted=predictions.get(item.id);
  if(!['same_problem','different_problem'].includes(predicted)){counts.unresolved++;continue;}
  if(predicted==='same_problem')counts[item.expected==='same_problem'?'tp':'fp']++;
  else counts[item.expected==='same_problem'?'fn':'tn']++;
 }
 const precision=counts.tp+counts.fp?counts.tp/(counts.tp+counts.fp):null;
 const recall=counts.tp+counts.fn?counts.tp/(counts.tp+counts.fn):null;
 return {...counts,precision,recall,coverage:(cases.length-counts.unresolved)/cases.length};
}
export async function evaluatePairs(cases,{limit=cases.length,judge=verifyProblemPair}={}){
 const predictions=[];
 for(const item of cases.slice(0,limit)){
  const pair={left_id:item.id+'-a',right_id:item.id+'-b',left_statement:item.left,left_excerpt:item.left,right_statement:item.right,right_excerpt:item.right};
  try{predictions.push({id:item.id,...await judge(pair)});}
  catch(error){predictions.push({id:item.id,verdict:'error',error:String(error?.message||error).slice(0,160)});}
 }
 return {kind:'development_synthetic_cases',independentHoldout:false,metrics:measurePairQuality(cases,predictions),results:predictions};
}
if(process.argv[1]?.endsWith('/packages/agents/evaluate-corroboration.mjs')){
 const input=JSON.parse(await readFile(new URL('../../eval/corroboration-pairs.json',import.meta.url),'utf8'));
 const report=await evaluatePairs(input.cases,{limit:Number(process.env.PIE_PAIR_EVAL_LIMIT||input.cases.length)});
 const path=process.env.PIE_PAIR_EVAL_REPORT_PATH;
 if(path)await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({metrics:report.metrics,results:report.results},null,2));
 if(report.metrics.unresolved)process.exitCode=1;
}
