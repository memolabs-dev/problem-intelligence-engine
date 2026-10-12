import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
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
 SELECT m.observation_id AS id,o.title,o.body,o.url,o.source,o.reporter_key,o.content_hash,e.embedding
 FROM ranked m JOIN observations o ON o.id=m.observation_id
 JOIN problem_embeddings e ON e.run_id=m.run_id AND e.observation_id=m.observation_id
 WHERE m.rn=1 AND m.status='found' AND m.source_content_hash=o.content_hash AND e.embedding_model=$3
 ORDER BY md5(m.observation_id || $2) LIMIT $1
)
SELECT a.id AS left_id,a.title AS left_title,a.body AS left_body,a.source AS left_source,a.url AS left_url,
 a.reporter_key AS left_account,a.content_hash AS left_hash,
 b.id AS right_id,b.title AS right_title,b.body AS right_body,b.source AS right_source,b.url AS right_url,
 b.reporter_key AS right_account,b.content_hash AS right_hash,
 1-(a.embedding <=> b.embedding) AS similarity
FROM current a JOIN current b ON a.id<b.id ORDER BY a.id,b.id`;

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
function cleanSnippet(value){
 return String(value||'').replace(/\s+/g,' ').trim().slice(0,1500);
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
export function sampleBlindPairs(rows,{target=150,seed='pie-holdout-v1',devIds=[]}={}){
 if(!Array.isArray(rows)||!Number.isInteger(target)||target<1||target>1000||typeof seed!=='string'||!seed.trim())throw Error('Invalid holdout sampling options');
 const dev=new Set(devIds),rejected={developerOverlap:0,invalid:0,duplicate:0};
 const buckets=new Map(BUCKETS.map(name=>[name,[]]));
 const seen=new Set();
 for(const row of rows){
  if(!validateSourceRow(row)){rejected.invalid++;continue;}
  if(dev.has(row.left_id)||dev.has(row.right_id)){rejected.developerOverlap++;continue;}
  const [idA,idB]=[row.left_id,row.right_id].sort();
  const key=idA+'|'+idB;
  if(seen.has(key)){rejected.duplicate++;continue;}
  seen.add(key);
  buckets.get(pairBucket(row)).push(row);
 }
 for(const pairs of buckets.values())pairs.sort((a,b)=>{
  const ha=digest(seed+':'+a.left_id+':'+a.right_id);
  const hb=digest(seed+':'+b.left_id+':'+b.right_id);
  return ha.localeCompare(hb);
 });
 const selected=[];
 while(selected.length<target){
  let changed=false;
  for(const bucket of BUCKETS){
   if(selected.length>=target)break;
   const candidate=buckets.get(bucket).shift();
   if(!candidate)continue;
   selected.push({...candidate,bucket});
   changed=true;
  }
  if(!changed)break;
 }
 const pairs=selected.map(row=>{
  const id=digest([row.left_id,row.left_hash,row.right_id,row.right_hash].join(':')).slice(0,24);
  return {pairId:id,
   left:{observationId:row.left_id,source:row.left_source,url:row.left_url,title:row.left_title,body:cleanSnippet(row.left_body)},
   right:{observationId:row.right_id,source:row.right_source,url:row.right_url,title:row.right_title,body:cleanSnippet(row.right_body)}
  };
 });
 const counts=Object.fromEntries(BUCKETS.map(bucket=>[bucket,selected.filter(row=>row.bucket===bucket).length]));
 return {
  blind:{kind:'unlabeled_human_annotation_queue',independentHoldout:false,target,pairs},
  manifest:{kind:'sampling_audit',seed,target,selected:pairs.length,shortfall:Math.max(0,target-pairs.length),
   candidatePool:rows.length,filtered:rejected,strata:counts,
   selections:selected.map((row,index)=>({pairId:pairs[index].pairId,bucket:row.bucket,similarity:Number(row.similarity)})),
   developmentExamplesExcluded:dev.size,
   note:'Selection uses development embeddings; no labels are present. This is not an independently validated benchmark.'}
 };
}
export function createAnnotationTemplate(blind,reviewer){
 if(typeof reviewer!=='string'||!/^[a-zA-Z0-9_-]{3,60}$/.test(reviewer))throw Error('Reviewer pseudonym required');
 if(blind?.kind!=='unlabeled_human_annotation_queue'||!Array.isArray(blind.pairs))throw Error('Invalid blind queue');
 return {kind:'human_pair_annotations',reviewer,annotations:blind.pairs.map(row=>({pairId:row.pairId,label:null,reason:null}))};
}
export async function prepareHoldout(pool,{target=150,maxNodes=200,seed='pie-holdout-v1',excludeDev=true}={}){
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
 for(const [path,value] of Object.entries(outputs))await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
 return paths;
}
if(process.argv[1]?.endsWith('/packages/agents/holdout.mjs')){
 const pool=createPool();
 try{
  const report=await prepareHoldout(pool,{
   target:Number(process.env.PIE_HOLDOUT_TARGET||150),
   maxNodes:Number(process.env.PIE_HOLDOUT_MAX_NODES||200),
   seed:process.env.PIE_HOLDOUT_SEED||'pie-holdout-v1'
  });
  const files=await writePreparedHoldout(report,process.env.PIE_HOLDOUT_OUTPUT||'/tmp/pie-holdout');
  console.log(JSON.stringify({selected:report.manifest.selected,target:report.manifest.target,shortfall:report.manifest.shortfall,excludedDevelopmentPairs:report.manifest.filtered.developerOverlap,strata:report.manifest.strata,files,independentHoldout:false},null,2));
 }finally{await pool.end();}
}
