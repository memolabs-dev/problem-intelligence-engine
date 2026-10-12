import {readFile} from 'node:fs/promises';

const LABELS=new Set(['same_problem','different_problem','uncertain']);
export function parseReviewerAnnotations(blind,submission){
 if(blind?.kind!=='unlabeled_human_annotation_queue'||!Array.isArray(blind.pairs))throw Error('Invalid blind pair queue');
 if(submission?.kind!=='human_pair_annotations'||typeof submission.reviewer!=='string'||!submission.reviewer.trim()||!Array.isArray(submission.annotations))throw Error('Invalid reviewer annotations');
 const expected=new Set(blind.pairs.map(pair=>pair.pairId));
 if(expected.size!==blind.pairs.length)throw Error('Duplicate blind pair IDs');
 const labels=new Map();
 for(const item of submission.annotations){
  if(!expected.has(item?.pairId)||labels.has(item.pairId))throw Error('Unknown or duplicate reviewed pair');
  if(item.label!==null&&!LABELS.has(item.label))throw Error('Invalid reviewer label');
  if(item.label!==null&&(typeof item.reason!=='string'||!item.reason.trim()))throw Error('Review rationale required');
  labels.set(item.pairId,item.label);
 }
 if(labels.size!==expected.size)throw Error('Reviewer submission must cover all pairs, using null for unanswered items');
 return {reviewer:submission.reviewer,labels};
}
export function evaluateIndependentReviews(blind,first,second,{predictions=[]}={}){
 const left=parseReviewerAnnotations(blind,first),right=parseReviewerAnnotations(blind,second);
 if(left.reviewer===right.reviewer)throw Error('Independent reviewer pseudonyms must differ');
 if(!Array.isArray(predictions))throw Error('Invalid model predictions');
 const pred=new Map();
 for(const p of predictions){
  if(!left.labels.has(p?.pairId)||pred.has(p.pairId)||!['same_problem','different_problem','uncertain','error'].includes(p?.verdict))throw Error('Invalid or duplicate model prediction');
  pred.set(p.pairId,p.verdict);
 }
 const counts={total:blind.pairs.length,unanswered:0,disagreements:0,uncertainConsensus:0,confirmedLabels:0};
 const confusion={tp:0,fp:0,tn:0,fn:0,missingPredictions:0};
 const disagreements=[];
 for(const pair of blind.pairs){
  const a=left.labels.get(pair.pairId),b=right.labels.get(pair.pairId);
  if(a===null||b===null){counts.unanswered++;continue;}
  if(a!==b){counts.disagreements++;disagreements.push(pair.pairId);continue;}
  if(a==='uncertain'){counts.uncertainConsensus++;continue;}
  counts.confirmedLabels++;
  const result=pred.get(pair.pairId);
  if(result!=='same_problem'&&result!=='different_problem'){confusion.missingPredictions++;continue;}
  if(result==='same_problem')confusion[a==='same_problem'?'tp':'fp']++;
  else confusion[a==='same_problem'?'fn':'tn']++;
 }
 const precision=confusion.tp+confusion.fp?confusion.tp/(confusion.tp+confusion.fp):null;
 const recall=confusion.tp+confusion.fn?confusion.tp/(confusion.tp+confusion.fn):null;
 const predictionCoverage=counts.confirmedLabels?
  (counts.confirmedLabels-confusion.missingPredictions)/counts.confirmedLabels:null;
 return {
  labelsProvidedBy:[left.reviewer,right.reviewer],
  reviewersExternallyVerifiedAsIndependentHumans:false,
  blindAnnotationProtocol:true,
  counts,disagreements,confusion,
  precision,recall,predictionCoverage,
  eligibleForExternalBenchmarkReview:counts.total>=blind.target && counts.unanswered===0 && counts.disagreements===0 && counts.confirmedLabels>0,
  readyToPublishAsIndependentlyVerified:false,
  caveat:'Reviewer pseudonyms and labels are supplied by users, not independently authenticated by this tool. No performance claim should be published without external review.'
 };
}
if(process.argv[1]?.endsWith('/packages/agents/holdout-review.mjs')){
 const [blindFile,aFile,bFile,predictionsFile]=process.argv.slice(2);
 if(!blindFile||!aFile||!bFile)throw Error('Usage: node packages/agents/holdout-review.mjs <blind.json> <reviewer-a.json> <reviewer-b.json> [predictions.json]');
 const [blind,a,b]=await Promise.all([blindFile,aFile,bFile].map(path=>readFile(path,'utf8').then(JSON.parse)));
 const predictions=predictionsFile?JSON.parse(await readFile(predictionsFile,'utf8')):[];
 console.log(JSON.stringify(evaluateIndependentReviews(blind,a,b,{predictions}),null,2));
}
