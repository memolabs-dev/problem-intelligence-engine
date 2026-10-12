import {readFile} from 'node:fs/promises';
import {evaluatePredictions} from './evaluate.mjs';

/**
 * A model error is not a negative prediction.
 * Distinguish extraction quality from completion reliability.
 */
export function evaluateLLMReport(labels,report){
 if(!Array.isArray(report?.results))throw Error('Invalid LLM report');
 const seen=new Set(),predictions={};
 const status={found:0,none:0,rejected:0,error:0};
 for(const result of report.results){
  if(typeof result?.observationId!=='string'||seen.has(result.observationId)||!Object.hasOwn(status,result.status))throw Error('Invalid or duplicate model result');
  seen.add(result.observationId);status[result.status]++;
  if(result.status==='found'){if(typeof result.candidate?.statement!=='string'||!result.candidate?.excerpt)throw Error('Found result without validated candidate');predictions[result.observationId]=true;}
  if(result.status==='none'||result.status==='rejected')predictions[result.observationId]=false;
 }
 const metrics=evaluatePredictions(labels,predictions);
 return {status,metrics:{tp:metrics.tp,fp:metrics.fp,tn:metrics.tn,fn:metrics.fn,missing:metrics.missing,precision:metrics.precision,recall:metrics.recall,f1:metrics.f1,coverage:metrics.coverage},disagreements:metrics.details.filter(x=>['fp','fn','missing'].includes(x.status))};
}
if(process.argv[1]?.endsWith('/packages/agents/evaluate-llm.mjs')){
 const file=process.argv[2];
 if(!file)throw Error('Usage: node packages/agents/evaluate-llm.mjs <report.json>');
 const labels=JSON.parse(await readFile(new URL('../../eval/labels.json',import.meta.url),'utf8'));
 const report=JSON.parse(await readFile(file,'utf8'));
 console.log(JSON.stringify(evaluateLLMReport(labels,report),null,2));
}
