import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {parseReviewerAnnotations,evaluateIndependentReviews} from './holdout-review.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const LABELS=new Set(['same_problem','different_problem','uncertain']);
export function prepareAdjudication(blind,reviewA,reviewB){
 const a=parseReviewerAnnotations(blind,reviewA),b=parseReviewerAnnotations(blind,reviewB);
 if(a.reviewer===b.reviewer)throw Error('Distinct reviewer pseudonyms are required');
 const disputed=blind.pairs.filter(p=>a.labels.get(p.pairId)!==b.labels.get(p.pairId));
 // Return detached copies so editing a review queue cannot mutate the original blind evidence.
 const entries=disputed.map(p=>({pairId:p.pairId,left:structuredClone(p.left),right:structuredClone(p.right),label:null,reason:null}));
 return {kind:'human_adjudication_queue',blindDigest:hash(blind),reviewDigests:[hash(reviewA),hash(reviewB)],
  reviewerPseudonyms:[a.reviewer,b.reviewer],items:entries,
  note:'Disagreements or unanswered labels require an external human adjudicator; no labels are filled automatically.'};
}
export function finalizeAdjudication(blind,reviewA,reviewB,queue,{predictions=[]}={}){
 const expected=prepareAdjudication(blind,reviewA,reviewB);
 if(queue?.kind!=='human_adjudication_queue'||queue.blindDigest!==expected.blindDigest||
  JSON.stringify(queue.reviewDigests)!==JSON.stringify(expected.reviewDigests)||
  !Array.isArray(queue.items)||queue.items.length!==expected.items.length)throw Error('Adjudication does not match frozen source and reviewer submissions');
 // The pair ID and outer file digests are not enough: a filled adjudication queue
 // could keep the same ID while presenting a different excerpt to the adjudicator.
 // Compare the whole source snapshots against the authoritative frozen blind queue.
 const frozenById=new Map(expected.items.map(item=>[item.pairId,item]));
 const expectedFields=['label','left','pairId','reason','right'];
 const resolved=new Map();
 for(const item of queue.items){
  const frozen=frozenById.get(item?.pairId);
  if(!frozen||resolved.has(item.pairId)||
   !isDeepStrictEqual(Object.keys(item).sort(),expectedFields)||
   !isDeepStrictEqual(item.left,frozen.left)||!isDeepStrictEqual(item.right,frozen.right))
   throw Error('Adjudication source snapshot differs from frozen blind queue');
  if(!LABELS.has(item.label)||typeof item.reason!=='string'||!item.reason.trim())
   throw Error('Human adjudication incomplete or invalid');
  resolved.set(item.pairId,item.label);
 }
 const a=parseReviewerAnnotations(blind,reviewA),b=parseReviewerAnnotations(blind,reviewB);
 const finalLabels=new Map();
 for(const pair of blind.pairs){
  const left=a.labels.get(pair.pairId),right=b.labels.get(pair.pairId);
  finalLabels.set(pair.pairId,left!==null&&left===right?left:resolved.get(pair.pairId));
 }
 const judgments=blind.pairs.map(pair=>({pairId:pair.pairId,label:finalLabels.get(pair.pairId)}));
 const predictionMap=new Map();
 for(const entry of predictions){
  if(!finalLabels.has(entry?.pairId)||predictionMap.has(entry.pairId)||
   !['same_problem','different_problem','uncertain','error'].includes(entry.verdict))throw Error('Invalid model prediction');
  predictionMap.set(entry.pairId,entry.verdict);
 }
 const confusion={tp:0,fp:0,tn:0,fn:0,missingPredictions:0};
 let uncertain=0;
 for(const j of judgments){
  if(j.label==='uncertain'){uncertain++;continue;}
  const pred=predictionMap.get(j.pairId);
  if(!['same_problem','different_problem'].includes(pred)){confusion.missingPredictions++;continue;}
  confusion[pred==='same_problem'?(j.label==='same_problem'?'tp':'fp'):(j.label==='same_problem'?'fn':'tn')]++;
 }
 const denominatorPrecision=confusion.tp+confusion.fp,denominatorRecall=confusion.tp+confusion.fn;
 const preliminary=evaluateIndependentReviews(blind,reviewA,reviewB,{predictions});
 return {kind:'human_adjudication_result',blindDigest:expected.blindDigest,reviewDigests:expected.reviewDigests,
  reviewerPseudonyms:expected.reviewerPseudonyms,disagreementsResolved:resolved.size,
  annotationCount:judgments.length,uncertain,judgments,confusion,
  precision:denominatorPrecision?confusion.tp/denominatorPrecision:null,
  recall:denominatorRecall?confusion.tp/denominatorRecall:null,
  independentHumansAuthenticated:false,independentBenchmarkVerified:false,
  preliminaryReviewerAgreement:preliminary.counts.confirmedLabels,
  caution:'Reviewers and adjudicator must be verified independently, outside this utility. These metrics do not validate sampling bias or independence.'};
}
if(process.argv[1]?.endsWith('/packages/agents/holdout-adjudication.mjs')){
 const [mode,blindPath,aPath,bPath,queuePath,predictionsPath]=process.argv.slice(2);
 if(!['prepare','finalize'].includes(mode)||!blindPath||!aPath||!bPath||!queuePath)
  throw Error('Usage: node holdout-adjudication.mjs prepare|finalize blind.json reviewer-a.json reviewer-b.json output-or-filled-queue.json [predictions.json]');
 const [blind,a,b]=await Promise.all([blindPath,aPath,bPath].map(p=>readFile(p,'utf8').then(JSON.parse)));
 if(mode==='prepare'){
  const queue=prepareAdjudication(blind,a,b);
  await writeFile(queuePath,JSON.stringify(queue,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({disputed:queue.items.length,path:queuePath,verifiedHumans:false}));
 }else{
  const queue=JSON.parse(await readFile(queuePath,'utf8'));
  const predictions=predictionsPath?JSON.parse(await readFile(predictionsPath,'utf8')):[];
  console.log(JSON.stringify(finalizeAdjudication(blind,a,b,queue,{predictions}),null,2));
 }
}
