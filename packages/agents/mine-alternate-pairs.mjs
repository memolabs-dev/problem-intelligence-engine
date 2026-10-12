import {createPool} from '../storage/postgres.mjs';
import {writeFile} from 'node:fs/promises';
import {embedLocalComparisonText} from './compare-embeddings.mjs';
import {cosineSimilarity} from './evaluate-embeddings.mjs';

export const CURRENT_MINING_PROBLEMS_SQL=`
WITH recent AS (
 SELECT d.run_id,d.observation_id,d.statement,d.status,d.source_content_hash,
 row_number() OVER(PARTITION BY d.observation_id ORDER BY r.started_at DESC,r.id DESC) AS rn
 FROM model_decisions d JOIN model_runs r ON r.id=d.run_id
)
SELECT m.run_id,m.observation_id AS id,m.statement,o.source,o.url,
       o.thread_root_id,o.reporter_key
FROM recent m JOIN observations o ON o.id=m.observation_id
WHERE m.rn=1 AND m.status='found' AND m.source_content_hash=o.content_hash
ORDER BY md5(m.observation_id || $2) LIMIT $1`;
export const PREVIOUS_MINING_VERDICTS_SQL=`
SELECT left_run,left_observation,right_run,right_observation,verdict
FROM corroboration_edges
WHERE verdict IN ('same_problem','different_problem','uncertain')`;
const key=(a,b)=>[a,b].sort().join('|');
function validateCandidate(row){
 return typeof row?.id==='string'&&typeof row.statement==='string'&&row.statement.trim()&&
  typeof row.run_id==='string'&&['github','hackernews'].includes(row.source)&&row.url?.startsWith('https://');
}
/** Rank unlabeled leads, not corroborated pairs or ground-truth labels. */
export function rankNovelCrossDiscussionPairs(rows,embeddings,priorEdges=[],{limit=12,maxPerObservation=3,minSimilarity=0.25}={}){
 if(!Array.isArray(rows)||!Array.isArray(embeddings)||rows.length!==embeddings.length||!Array.isArray(priorEdges)||
  !Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(maxPerObservation)||maxPerObservation<1||maxPerObservation>10||
  !Number.isFinite(minSimilarity)||minSimilarity< -1||minSimilarity>1)throw Error('Invalid mining input or budget');
 if(rows.some(row=>!validateCandidate(row)))throw Error('Invalid verified source candidate');
 const excluded=new Set();
 const snapshot=new Map(rows.map(row=>[row.id,row.run_id]));
 for(const edge of priorEdges){
  if(!['same_problem','different_problem','uncertain'].includes(edge.verdict))continue;
  if(snapshot.get(edge.left_observation)===edge.left_run&&snapshot.get(edge.right_observation)===edge.right_run)
   excluded.add(key(edge.left_observation,edge.right_observation));
 }
 const candidates=[];
 let sameThreadSkipped=0,alreadyReviewedSkipped=0;
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  const a=rows[i],b=rows[j];
  if(a.id===b.id|| (a.thread_root_id||a.id)===(b.thread_root_id||b.id)){sameThreadSkipped++;continue;}
  if(excluded.has(key(a.id,b.id))){alreadyReviewedSkipped++;continue;}
  const similarity=cosineSimilarity(embeddings[i],embeddings[j]);
  if(similarity<minSimilarity)continue;
  candidates.push({leftId:a.id,rightId:b.id,similarity,platformPair:[a.source,b.source].sort().join('+'),
   left:a,right:b});
 }
 candidates.sort((a,b)=>b.similarity-a.similarity||key(a.leftId,a.rightId).localeCompare(key(b.leftId,b.rightId)));
 const result=[],exposure=new Map();
 for(const row of candidates){
  if(result.length>=limit)break;
  if((exposure.get(row.leftId)||0)>=maxPerObservation||(exposure.get(row.rightId)||0)>=maxPerObservation)continue;
  exposure.set(row.leftId,(exposure.get(row.leftId)||0)+1);
  exposure.set(row.rightId,(exposure.get(row.rightId)||0)+1);
  const distinctAccounts=row.left.source===row.right.source&&row.left.reporter_key&&row.right.reporter_key
   ?row.left.reporter_key!==row.right.reporter_key:null;
  result.push({left:{id:row.leftId,url:row.left.url,source:row.left.source,statement:row.left.statement},
   right:{id:row.rightId,url:row.right.url,source:row.right.source,statement:row.right.statement},
   similarity:Number(row.similarity.toFixed(4)),platformPair:row.platformPair,
   distinctSourceAccounts:distinctAccounts,independentlyVerifiedHumans:null,
   semanticEquivalence:'unreviewed',commercialDemand:'unknown'});
 }
 return {selected:result,eligibleScoredPairs:candidates.length,sameThreadSkipped,alreadyReviewedSkipped};
}
export async function mineAlternateEmbeddingPairs(pool,{model='nomic-embed-text',maxNodes=100,maxPairs=12,
 maxPerObservation=3,minSimilarity=0.25,embed=embedLocalComparisonText}={}){
 if(typeof model!=='string'||!/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?$/i.test(model)||
  !Number.isInteger(maxNodes)||maxNodes<2||maxNodes>150)throw Error('Invalid local model or node budget');
 const {rows}=await pool.query(CURRENT_MINING_PROBLEMS_SQL,[maxNodes,'alternate-embedding-mining-v1']);
 if(rows.length<2)return {kind:'unreviewed_alternate_embedding_candidates',model,sourceObservations:rows.length,
  independentHoldout:false,productionEmbeddingsUnchanged:true,pairs:[],reason:'insufficient_current_sources'};
 const {rows:reviewed}=await pool.query(PREVIOUS_MINING_VERDICTS_SQL);
 const embeddings=[];
 for(const row of rows)embeddings.push(await embed(row.statement,{model}));
 const mining=rankNovelCrossDiscussionPairs(rows,embeddings,reviewed,{limit:maxPairs,maxPerObservation,minSimilarity});
 return {kind:'unreviewed_alternate_embedding_candidates',model,sourceObservations:rows.length,
  independentHoldout:false,productionEmbeddingsUnchanged:true,modelJudgmentsPerformed:0,
  ...mining,pairs:mining.selected,selected:undefined,
  caveat:'Candidate mining only: these are not same-problem labels, independent human confirmations, or market demand. Do not add mined pairs to frozen independent holdouts without a new sampling and leakage protocol.'};
}
if(process.argv[1]?.endsWith('/packages/agents/mine-alternate-pairs.mjs')){
 const pool=createPool();try{
  const result=await mineAlternateEmbeddingPairs(pool,{
   model:process.env.PIE_ALTERNATE_EMBED_MODEL||'nomic-embed-text',
   maxNodes:Number(process.env.PIE_ALTERNATE_MAX_NODES||100),
   maxPairs:Number(process.env.PIE_ALTERNATE_MAX_PAIRS||12),
   minSimilarity:Number(process.env.PIE_ALTERNATE_MIN_SIMILARITY||0.25)
  });
  const path=process.env.PIE_ALTERNATE_MINING_REPORT_PATH;
  if(path)await writeFile(path,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(result,null,2));
 }finally{await pool.end();}
}
