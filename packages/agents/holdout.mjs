import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createPool} from '../storage/postgres.mjs';
import {EMBEDDING_MODEL} from './embed.mjs';

/**
 * Deterministic source-based pair sampling for a human-labeled holdout.
 * Model predictions, existing corroboration verdicts, account IDs and
 * embedding similarity never appear in the annotator-facing output.
 */
export const HOLDOUT_PAIR_POOL_SQL=`
WITH ranked AS (
 SELECT md.run_id,md.observation_id,md.status,md.source_content_hash,
        row_number() OVER(PARTITION BY md.observation_id ORDER BY run.started_at DESC,run.id DESC) AS rn
 FROM model_decisions md JOIN model_runs run ON run.id=md.run_id
), current AS (
 SELECT m.observation_id AS id,o.title,o.body,o.url,o.source,o.reporter_key,o.thread_root_id,o.content_hash,e.embedding
 FROM ranked m JOIN observations o ON o.id=m.observation_id
 JOIN problem_embeddings e ON e.run_id=m.run_id AND e.observation_id=m.observation_id
 WHERE m.rn=1 AND m.status='found' AND m.source_content_hash=o.content_hash AND e.embedding_model=$3
 ORDER BY md5(m.observation_id || $2) LIMIT $1
)
SELECT a.id AS left_id,a.title AS left_title,a.body AS left_body,a.source AS left_source,a.url AS left_url,
 a.reporter_key AS left_account,a.thread_root_id AS left_thread_root,a.content_hash AS left_hash,
 b.id AS right_id,b.title AS right_title,b.body AS right_body,b.source AS right_source,b.url AS right_url,
 b.reporter_key AS right_account,b.thread_root_id AS right_thread_root,b.content_hash AS right_hash,
 1-(a.embedding <=> b.embedding) AS similarity
FROM current a JOIN current b ON a.id<b.id
WHERE COALESCE(a.thread_root_id,a.id)<>COALESCE(b.thread_root_id,b.id)
AND NOT EXISTS (
 SELECT 1 FROM corroboration_edges previously_reviewed
 WHERE (previously_reviewed.left_observation=a.id AND previously_reviewed.right_observation=b.id)
    OR (previously_reviewed.left_observation=b.id AND previously_reviewed.right_observation=a.id)
)
ORDER BY a.id,b.id`;

function digest(value){return createHash('sha256').update(value).digest('hex');}
function siteRepo(url){
 const m=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\//i.exec(url||'');
 return m?m[1].toLowerCase():null;
}
function pairBucket(row){
 if(row.left_account&&row.left_account===row.right_account)return 'repeated_account';
 if(row.left_source!==row.right_source)return 'cross_platform';
 const l=siteRepo(row.left_url),r=siteRepo(row.right_url);
 if(l&&l===r)return 'same_repository';
 const score=Number(row.similarity);
 if(score>=0.68)return 'semantically_close';
 if(score>=0.35)return 'semantically_related';
 return 'semantic_distant';
}
const BUCKETS=['repeated_account','cross_platform','same_repository','semantically_close','semantically_related','semantic_distant'];
const CHALLENGE_BANDS=['near_miss_candidate','ambiguous_candidate','contextual_candidate','easy_negative_candidate'];
function challengeBand(score){
 if(score>=0.60)return CHALLENGE_BANDS[0];
 if(score>=0.35)return CHALLENGE_BANDS[1];
 if(score>=0.15)return CHALLENGE_BANDS[2];
 return CHALLENGE_BANDS[3];
}
function cleanSnippet(value){
 return String(value||'').replace(/\\s+/g,' ').trim().slice(0,1500);
}
function validateSourceRow(row){
 const ids=['left_id','right_id'];
 if(ids.some(key=>typeof row?.[key]!=='string'||!row[key]))return false;
 if(row.left_id===row.right_id)return false;
 if(!row.left_url?.startsWith('https://')||!row.right_url?.startsWith('https://'))return false;
 if(typeof row.left_title!=='string'||typeof row.right_title!=='string')return false;
 if(!/^[0-9a-f]{64}$/.test(String(row.left_hash||'').trim())||!/^[0-9a-f]{64}$/.test(String(row.right_hash||'').trim()))return false;
 return Number.isFinite(Number(row.similarity));
}
function sortedKey(row){return [row.left_id,row.right_id].sort().join('|');}
function originalThread(row,side){return row[side+'_thread_root']||row[side+'_id'];}
export function sampleBlindPairs(rows,{target=150,seed='pie-holdout-v2',devIds=[],reviewedPairs=[]}={}){
 if(!Array.isArray(rows)||!Number.isInteger(target)||target<1||target>1000||typeof seed!=='string'||!seed.trim())throw Error('Invalid holdout sampling options');
 if(!Array.isArray(reviewedPairs))throw Error('Invalid prior-reviewed pair exclusions');
 const reviewed=new Set(reviewedPairs.map(p=>typeof p==='string'?p:(Array.isArray(p)?p:[p?.left,p?.right]).sort().join('|')));
 const dev=new Set(devIds),rejected={developerOverlap:0,previouslyJudged:0,sameOriginalThread:0,invalid:0,duplicate:0};
 const candidates=[],seen=new Set();
 for(const row of rows){
  if(!validateSourceRow(row)){rejected.invalid++;continue;}
  if(originalThread(row,'left')===originalThread(row,'right')){rejected.sameOriginalThread++;continue;}
  if(dev.has(row.left_id)||dev.has(row.right_id)){rejected.developerOverlap++;continue;}
  const key=sortedKey(row);
  if(reviewed.has(key)){rejected.previouslyJudged++;continue;}
  if(seen.has(key)){rejected.duplicate++;continue;}
  seen.add(key);
  candidates.push({...row,bucket:pairBucket(row),challengeBand:challengeBand(Number(row.similarity))});
 }
 // Stratify by difficulty before provenance. Earlier source-first sampling
 // buried almost all high-similarity candidates in its easy-negative majority.
 // These are still unlabeled CANDIDATES and may all be negative.
 const buckets=new Map(CHALLENGE_BANDS.map(name=>[name,new Map(BUCKETS.map(b=>[b,[]]))]));
 for(const row of candidates)buckets.get(row.challengeBand).get(row.bucket).push(row);
 for(const byProvenance of buckets.values()){
  for(const pairs of byProvenance.values())pairs.sort((a,b)=>{
   const ha=digest(seed+':'+sortedKey(a));
   const hb=digest(seed+':'+sortedKey(b));
   return ha.localeCompare(hb);
  });
 }
 const desired=[Math.ceil(target*0.25),Math.ceil(target*0.35),Math.ceil(target*0.25),target];
 const selected=[];
 const sourceExposure=new Map();
 const maxExposure=Math.max(12,Math.ceil(target*0.18));
 function takeFromBand(name,maxTake,allowOverexposure=false){
  const byProvenance=buckets.get(name);
  let taken=0,changed=true;
  while(taken<maxTake&&changed&&selected.length<target){
   changed=false;
   for(const bucket of BUCKETS){
    if(taken>=maxTake||selected.length>=target)break;
    const queue=byProvenance.get(bucket);
    const index=queue.findIndex(row=>allowOverexposure||
       (sourceExposure.get(row.left_id)||0)<maxExposure&&(sourceExposure.get(row.right_id)||0)<maxExposure);
    if(index<0)continue;
    const [row]=queue.splice(index,1);
    selected.push(row);taken++;changed=true;
    sourceExposure.set(row.left_id,(sourceExposure.get(row.left_id)||0)+1);
    sourceExposure.set(row.right_id,(sourceExposure.get(row.right_id)||0)+1);
   }
  }
 }
 CHALLENGE_BANDS.forEach((band,index)=>takeFromBand(band,desired[index]));
 // Fill available slots while keeping any one source from dominating.
 for(const band of CHALLENGE_BANDS)takeFromBand(band,target);
 // Small archives can be so sparse that a strict exposure cap prevents reaching
 // the target. Record the concentration rather than silently discard pairs.
 if(selected.length<target)for(const band of CHALLENGE_BANDS)takeFromBand(band,target,true);
 const pairs=selected.map(row=>{
  const id=digest([row.left_id,row.left_hash,row.right_id,row.right_hash].join(':')).slice(0,24);
  return {pairId:id,
   left:{observationId:row.left_id,source:row.left_source,url:row.left_url,title:row.left_title,body:cleanSnippet(row.left_body)},
   right:{observationId:row.right_id,source:row.right_source,url:row.right_url,title:row.right_title,body:cleanSnippet(row.right_body)}
  };
 });
 const counts=Object.fromEntries(BUCKETS.map(bucket=>[bucket,selected.filter(row=>row.bucket===bucket).length]));
 const challengeCounts=Object.fromEntries(CHALLENGE_BANDS.map(b=>[b,selected.filter(row=>row.challengeBand===b).length]));
 const availableChallengeCounts=Object.fromEntries(CHALLENGE_BANDS.map(b=>[b,candidates.filter(row=>row.challengeBand===b).length]));
 return {
  blind:{kind:'unlabeled_human_annotation_queue',independentHoldout:false,target,pairs},
  manifest:{kind:'sampling_audit',seed,target,selected:pairs.length,shortfall:Math.max(0,target-pairs.length),
   candidatePool:rows.length,eligibleCandidates:candidates.length,filtered:rejected,strata:counts,
   challengeBands:challengeCounts,availableChallengeBands:availableChallengeCounts,
   highSimilarityCandidateCount:selected.filter(row=>Number(row.similarity)>=0.60).length,
   mediumSimilarityCandidateCount:selected.filter(row=>Number(row.similarity)>=0.35&&Number(row.similarity)<0.60).length,
   maxSourceExposure:Math.max(0,...sourceExposure.values()),
   selections:selected.map((row,index)=>({pairId:pairs[index].pairId,bucket:row.bucket,challengeBand:row.challengeBand,similarity:Number(row.similarity),
    leftOriginalThread:originalThread(row,'left'),rightOriginalThread:originalThread(row,'right')})),
   developmentExamplesExcluded:dev.size,leakagePolicy:'exclude_all_previous_semantic_model_reviewed_pairs',
   note:'Difficulty prioritization is candidate mining, not labels or evidence of positive cases. This is not an independently validated benchmark.'}
 };
}
export function createAnnotationTemplate(blind,reviewer){
 if(typeof reviewer!=='string'||!/^[a-zA-Z0-9_-]{3,60}$/.test(reviewer))throw Error('Reviewer pseudonym required');
 if(blind?.kind!=='unlabeled_human_annotation_queue'||!Array.isArray(blind.pairs))throw Error('Invalid blind queue');
 return {kind:'human_pair_annotations',reviewer,annotations:blind.pairs.map(row=>({pairId:row.pairId,label:null,reason:null}))};
}
export async function prepareHoldout(pool,{target=150,maxNodes=200,seed='pie-holdout-v2',excludeDev=true}={}){
 if(!Number.isInteger(maxNodes)||maxNodes<2||maxNodes>200)throw Error('Invalid maximum holdout nodes');
 const {rows}=await pool.query(HOLDOUT_PAIR_POOL_SQL,[maxNodes,seed,EMBEDDING_MODEL]);
 const devIds=excludeDev?JSON.parse(await readFile(new URL('../../eval/labels.json',import.meta.url),'utf8')).map(row=>row.id):[];
 return sampleBlindPairs(rows,{target,seed,devIds});
}
export async function writePreparedHoldout(report,prefix){
 if(typeof prefix!=='string'||!prefix.startsWith('/'))throw Error('Absolute output prefix required');
 await mkdir(dirname(prefix),{recursive:true});
 const paths={
  blind:prefix+'-blind.json',audit:prefix+'-audit.json',
  reviewerA:prefix+'-reviewer-a.json',reviewerB:prefix+'-reviewer-b.json'
 };
 const outputs={
  [paths.blind]:report.blind,
  [paths.audit]:report.manifest,
  [paths.reviewerA]:createAnnotationTemplate(report.blind,'reviewer-a'),
  [paths.reviewerB]:createAnnotationTemplate(report.blind,'reviewer-b')
 };
 // A holdout must never silently overwrite a frozen review queue or answered template.
 for(const path of Object.keys(outputs)){
  try{await access(path);throw Error('Frozen holdout already exists: '+path);}
  catch(error){if(error?.code!=='ENOENT')throw error;}
 }
 for(const [path,value] of Object.entries(outputs))await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
 return paths;
}
if(process.argv[1]?.endsWith('/packages/agents/holdout.mjs')){
 const pool=createPool();
 try{
  const report=await prepareHoldout(pool,{
   target:Number(process.env.PIE_HOLDOUT_TARGET||150),
   maxNodes:Number(process.env.PIE_HOLDOUT_MAX_NODES||200),
   seed:process.env.PIE_HOLDOUT_SEED||'pie-holdout-v2'
  });
  const files=await writePreparedHoldout(report,process.env.PIE_HOLDOUT_OUTPUT||'/tmp/pie-holdout-v2');
  console.log(JSON.stringify({selected:report.manifest.selected,target:report.manifest.target,shortfall:report.manifest.shortfall,excludedDevelopmentPairs:report.manifest.filtered.developerOverlap,strata:report.manifest.strata,challengeBands:report.manifest.challengeBands,highSimilarityCandidateCount:report.manifest.highSimilarityCandidateCount,filteredPreviouslyJudged:report.manifest.filtered.previouslyJudged,files,independentHoldout:false},null,2));
 }finally{await pool.end();}
}
