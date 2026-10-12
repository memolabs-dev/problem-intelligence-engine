import {readFile} from 'node:fs/promises';
import {createPool} from '../storage/postgres.mjs';
import {prepareHoldout} from './holdout.mjs';

export const DEFAULT_QUALITY_POLICY=Object.freeze({
 minimumPairs:150,
 minimumHighSimilarity:12,
 minimumMediumSimilarity:25,
 minimumCrossPlatform:15,
 minimumDistinctMinorityPlatformRoots:8,
 maximumSourceShare:0.30
});
const ALLOWED_BANDS=new Set(['near_miss_candidate','ambiguous_candidate','contextual_candidate','easy_negative_candidate']);
function validId(id){return typeof id==='string'&&/^[a-f0-9]{24}$/.test(id);}
function sourceRoots(pairs){
 const counts=new Map();
 for(const pair of pairs){
  for(const side of ['left','right']){
   const id=pair[side].observationId;
   counts.set(id,(counts.get(id)||0)+1);
  }
 }
 return [...counts.values()];
}
export function assessHoldoutQuality(blind,audit,{policy=DEFAULT_QUALITY_POLICY}={}){
 if(blind?.kind!=='unlabeled_human_annotation_queue'||!Array.isArray(blind.pairs)||
  audit?.kind!=='sampling_audit'||!Array.isArray(audit.selections))throw Error('Expected blind pairs and sampling audit');
 const errors=[],warnings=[];
 if(!Number.isInteger(audit.target)||audit.target<1||audit.target>1000)errors.push('invalid_target');
 if(audit.target!==blind.target)errors.push('target_mismatch');
 if(blind.pairs.length!==audit.selected||audit.selections.length!==blind.pairs.length)errors.push('pair_count_mismatch');
 const seen=new Set(),pairs=new Set();
 for(const pair of blind.pairs){
  if(!validId(pair?.pairId)||seen.has(pair.pairId)){errors.push('duplicate_or_invalid_pair_id');continue;}
  seen.add(pair.pairId);
  if(!pair.left?.observationId||!pair.right?.observationId||pair.left.observationId===pair.right.observationId)errors.push('invalid_pair_roots');
  if(!pair.left?.url?.startsWith('https://')||!pair.right?.url?.startsWith('https://'))errors.push('missing_source_url');
  if(!(pair.left?.title?.trim()||pair.left?.body?.trim())||!(pair.right?.title?.trim()||pair.right?.body?.trim()))errors.push('missing_source_content');
  const pairKey=[pair.left.observationId,pair.right.observationId].sort().join('|');
  if(pairs.has(pairKey))errors.push('duplicate_source_pair');
  pairs.add(pairKey);
 }
 const auditIds=new Set();
 for(const selection of audit.selections){
  if(!validId(selection?.pairId)||auditIds.has(selection.pairId)||!seen.has(selection.pairId))errors.push('audit_pair_mismatch');
  auditIds.add(selection.pairId);
  if(!Number.isFinite(Number(selection.similarity))||Number(selection.similarity)<-1||Number(selection.similarity)>1)errors.push('invalid_similarity');
  if(!ALLOWED_BANDS.has(selection.challengeBand))errors.push('invalid_challenge_band');
 }
 const n=blind.pairs.length;
 const high=audit.selections.filter(x=>Number(x.similarity)>=0.60).length;
 const medium=audit.selections.filter(x=>Number(x.similarity)>=0.35&&Number(x.similarity)<0.60).length;
 const crossPairs=blind.pairs.filter(x=>x.left.source!==x.right.source);
 const cross=crossPairs.length;
 const crossPlatformRoots=new Map();
 for(const pair of crossPairs){
  for(const item of [pair.left,pair.right]){
   if(!crossPlatformRoots.has(item.source))crossPlatformRoots.set(item.source,new Set());
   crossPlatformRoots.get(item.source).add(item.observationId);
  }
 }
 const distinctCrossPlatformRoots=Object.fromEntries([...crossPlatformRoots].map(([source,ids])=>[source,ids.size]));
 const minorityCrossPlatformRoots=crossPlatformRoots.size>=2?Math.min(...[...crossPlatformRoots.values()].map(ids=>ids.size)):0;
 const exposures=sourceRoots(blind.pairs);
 const maxExposure=Math.max(0,...exposures);
 const exposureShare=n?maxExposure/n:0;
 if(n<policy.minimumPairs)warnings.push('not_enough_pairs');
 if(high<policy.minimumHighSimilarity)warnings.push('too_few_high_similarity_candidates');
 if(medium<policy.minimumMediumSimilarity)warnings.push('too_few_medium_similarity_candidates');
 if(cross<policy.minimumCrossPlatform)warnings.push('too_few_cross_platform_pairs');
 if(minorityCrossPlatformRoots<(policy.minimumDistinctMinorityPlatformRoots??0))warnings.push('too_few_distinct_cross_platform_observations');
 if(exposureShare>policy.maximumSourceShare)warnings.push('source_concentration_too_high');
 // Zero exclusions can be legitimate for a fresh pool; do not mark it unsafe
 // without evidence that previously judged examples were actually included.
 // Similarity measures candidate mining only. NEVER interpret it as a positive label.
 return {
  status:errors.length?'invalid':warnings.length?'needs_more_candidates':'ready_for_human_annotation',
  independentValidationAchieved:false,
  modelAccuracyEstablished:false,
  counts:{target:audit.target,pairs:n,highSimilarityCandidates:high,mediumSimilarityCandidates:medium,
   crossPlatformPairs:cross,distinctCrossPlatformRootsByPlatform:distinctCrossPlatformRoots,
   minorityCrossPlatformObservationCount:minorityCrossPlatformRoots,
   uniqueObservationRoots:exposures.length,maxSourceExposure:maxExposure,
   maxSourceExposureShare:Number(exposureShare.toFixed(3)),previousModelReviewExclusions:audit.filtered?.previouslyJudged??null,
   developerOverlapExclusions:audit.filtered?.developerOverlap??null},
  blockers:[...new Set([...errors,...warnings])],
  recommendedAction:errors.length?'Discard malformed export and regenerate.':warnings.length?
   'Mine more public source-grounded hard paraphrases, same-technology negative pairs and cross-community problems before independent labeling.':
   'Freeze this candidate pool, collect independent human labels, then adjudicate disagreements before publishing any metrics.'
 };
}
if(process.argv[1]?.endsWith('/packages/agents/holdout-quality.mjs')){
 const [blindFile,auditFile]=process.argv.slice(2);
 let blind,audit;
 if(blindFile&&auditFile){
  [blind,audit]=await Promise.all([blindFile,auditFile].map(path=>readFile(path,'utf8').then(JSON.parse)));
 }else{
  const pool=createPool();
  try{({blind,manifest:audit}=await prepareHoldout(pool));}
  finally{await pool.end();}
 }
 const result=assessHoldoutQuality(blind,audit);
 console.log(JSON.stringify(result,null,2));
 if(result.status==='invalid')process.exitCode=2;
}
