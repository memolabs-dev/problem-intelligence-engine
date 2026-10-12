import {readFile} from 'node:fs/promises';
import {createPool} from '../storage/postgres.mjs';
import {extractProblem} from './extract.mjs';

export function evaluatePredictions(labels, predictions) {
 if(!Array.isArray(labels)||labels.length===0)throw new Error('Nonempty evaluation labels required');
 const seen=new Set();for(const item of labels){if(typeof item?.id!=='string'||!item.id||typeof item.problem!=='boolean'||seen.has(item.id))throw new Error('Invalid or duplicate evaluation label');seen.add(item.id);}
 const counts={tp:0,fp:0,tn:0,fn:0,missing:0};
 const details=[];
 for(const item of labels){
  if(!Object.hasOwn(predictions,item.id)){counts.missing++;details.push({id:item.id,status:'missing'});continue;}
  const predicted=Boolean(predictions[item.id]);
  const expected=item.problem===true;
  const outcome=predicted?(expected?'tp':'fp'):(expected?'fn':'tn');
  counts[outcome]++;details.push({id:item.id,status:outcome});
 }
 const precision=counts.tp+counts.fp?counts.tp/(counts.tp+counts.fp):null;
 const recall=counts.tp+counts.fn?counts.tp/(counts.tp+counts.fn):null;
 const f1=precision===null||recall===null||precision+recall===0?null:2*precision*recall/(precision+recall);
 return {...counts,precision,recall,f1,coverage:(labels.length-counts.missing)/labels.length,details};
}
export function compareExtractors(labels, observations, extractors){
 const outputs={};
 for(const [name,extract] of Object.entries(extractors)){
  const predictions=Object.fromEntries(observations.map(observation=>[observation.id,Boolean(extract(observation))]));
  outputs[name]=evaluatePredictions(labels,predictions);
 }
 return outputs;
}
export async function evaluateStored(pool,labels){
 const {rows}=await pool.query('SELECT id,title,body,url FROM observations WHERE id=ANY($1::text[])',[labels.map(x=>x.id)]);
 const predictions=Object.fromEntries(rows.map(row=>[row.id,Boolean(extractProblem(row))]));
 return evaluatePredictions(labels,predictions);
}
if(process.argv[1]?.endsWith('/packages/agents/evaluate.mjs')){
 const labels=JSON.parse(await readFile(new URL('../../eval/labels.json',import.meta.url),'utf8'));
 const pool=createPool();try{console.log(JSON.stringify(await evaluateStored(pool,labels),null,2));}finally{await pool.end();}
}
