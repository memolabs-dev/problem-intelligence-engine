import {readFile,writeFile} from 'node:fs/promises';
import {embedText,EMBEDDING_MODEL} from './embed.mjs';

export function cosineSimilarity(left,right){
 if(!Array.isArray(left)||!Array.isArray(right)||left.length!==right.length||!left.length||
    !left.every(Number.isFinite)||!right.every(Number.isFinite))throw Error('Invalid comparable embeddings');
 let dot=0,aa=0,bb=0;
 for(let i=0;i<left.length;i++){dot+=left[i]*right[i];aa+=left[i]*left[i];bb+=right[i]*right[i];}
 if(aa<1e-20||bb<1e-20)throw Error('Cannot compare zero-norm embeddings');
 return Math.max(-1,Math.min(1,dot/Math.sqrt(aa*bb)));
}

export function summarizeRetrievalScores(scores,{thresholds=[0.3,0.4,0.5,0.6,0.7]}={}){
 if(!Array.isArray(scores)||!scores.length||scores.some(x=>!['same_problem','different_problem'].includes(x.expected)||
   typeof x.similarity!=='number'||!Number.isFinite(x.similarity)||x.similarity<-1||x.similarity>1))throw Error('Invalid labeled development scores');
 const positives=scores.filter(x=>x.expected==='same_problem').map(x=>x.similarity);
 const negatives=scores.filter(x=>x.expected==='different_problem').map(x=>x.similarity);
 const positiveMin=positives.length?Math.min(...positives):null;
 const negativeMax=negatives.length?Math.max(...negatives):null;
 const thresholdStats=thresholds.map(threshold=>{
  if(typeof threshold!=='number'||!Number.isFinite(threshold)||threshold<0||threshold>1)throw Error('Invalid similarity threshold');
  const tp=scores.filter(x=>x.expected==='same_problem'&&x.similarity>=threshold).length;
  const fp=scores.filter(x=>x.expected==='different_problem'&&x.similarity>=threshold).length;
  const fn=positives.length-tp,tn=negatives.length-fp;
  return {threshold,tp,fp,fn,tn,
   precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null};
 });
 return {cases:scores.length,positiveExamples:positives.length,negativeExamples:negatives.length,
  positiveMin,positiveMax:positives.length?Math.max(...positives):null,
  negativeMin:negatives.length?Math.min(...negatives):null,negativeMax,
  similarityOverlap:positiveMin!==null&&negativeMax!==null?positiveMin<=negativeMax:null,
  thresholdStats};
}

export async function evaluateEmbeddingRetrieval(cases,{embed=embedText,model=EMBEDDING_MODEL}={}){
 if(!Array.isArray(cases)||!cases.length||cases.some(c=>!c?.id||!c.left?.trim()||!c.right?.trim()))throw Error('Expected synthetic development pairs');
 const scores=[];
 for(const item of cases){
  const left=await embed(item.left),right=await embed(item.right);
  scores.push({id:item.id,expected:item.expected,similarity:Number(cosineSimilarity(left,right).toFixed(4))});
 }
 return {kind:'development_embedding_retrieval_diagnostic',model,independentHoldout:false,
  marketDemandValidated:false,metrics:summarizeRetrievalScores(scores),pairs:scores,
  caveat:'Synthetic cases used in development; these metrics cannot establish generalization or real-world corroboration accuracy.'};
}
if(process.argv[1]?.endsWith('/packages/agents/evaluate-embeddings.mjs')){
 const data=JSON.parse(await readFile(new URL('../../eval/corroboration-pairs.json',import.meta.url),'utf8'));
 if(data.kind!=='development_synthetic_cases'||data.independentHoldout!==false)throw Error('Only synthetic development cases allowed');
 const report=await evaluateEmbeddingRetrieval(data.cases);
 const path=process.env.PIE_EMBED_DIAGNOSTIC_REPORT_PATH;
 if(path)await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(report,null,2));
}
