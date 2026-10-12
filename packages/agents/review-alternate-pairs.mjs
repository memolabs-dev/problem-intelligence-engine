import {readFile,writeFile} from 'node:fs/promises';
import {createPool} from '../storage/postgres.mjs';
import {verifyProblemPair,SEMANTIC_REVIEW_POLICY_VERSION} from './corroborate.mjs';
import {EMBEDDING_MODEL} from './embed.mjs';

/** All source revisions must still be current at review time. */
export const ALTERNATE_REVIEW_CURRENT_SQL=`
WITH latest AS (
 SELECT d.run_id,d.observation_id,d.status,d.statement,d.excerpt,d.source_content_hash,
 row_number() OVER(PARTITION BY d.observation_id ORDER BY r.started_at DESC,r.id DESC) rn
 FROM model_decisions d JOIN model_runs r ON r.id=d.run_id
)
SELECT d.run_id,d.observation_id,d.status,d.statement,d.excerpt,
 o.thread_root_id,o.content_hash,o.url,o.source
FROM latest d JOIN observations o ON o.id=d.observation_id
WHERE d.rn=1 AND d.status='found' AND d.source_content_hash=o.content_hash
AND d.observation_id=ANY($1::text[])`;
const priorSQL=`SELECT verdict,rationale FROM corroboration_edges
WHERE left_run=$1 AND left_observation=$2 AND right_run=$3 AND right_observation=$4 AND model=$5 LIMIT 1`;
const saveSQL=`INSERT INTO corroboration_edges
(left_run,left_observation,right_run,right_observation,model,verdict,rationale)
VALUES ($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT(left_run,left_observation,right_run,right_observation,model)
DO UPDATE SET verdict=EXCLUDED.verdict,rationale=EXCLUDED.rationale,compared_at=NOW()
WHERE EXCLUDED.verdict<>'error'`;
export function validateAlternateMiningQueue(queue,{limit=12}={}){
 if(queue?.kind!=='unreviewed_alternate_embedding_candidates'||!Array.isArray(queue.pairs)||
  !Number.isInteger(limit)||limit<1||limit>24)throw Error('Invalid alternate candidate report or review budget');
 const seen=new Set();
 const pairs=[];
 for(const item of queue.pairs.slice(0,limit)){
  const a=item?.left?.id,b=item?.right?.id;
  if(typeof a!=='string'||typeof b!=='string'||!a||!b||a===b||
   typeof item.left.runId!=='string'||!item.left.runId||typeof item.right.runId!=='string'||!item.right.runId)
   throw Error('Invalid mined source pair or missing source snapshot; regenerate the mined report');
  const sorted=[a,b].sort();const key=sorted.join('|');
  if(seen.has(key))throw Error('Repeated mined source pair');
  seen.add(key);pairs.push(sorted);
 }
 return pairs;
}
export async function reviewAlternatePairs(pool,queue,{limit=12,reviewerModel='nvidia/nemotron-3.5-lightning:free',
 judge=verifyProblemPair}={}){
 if(!reviewerModel.endsWith(':free'))throw Error('Review requires the approved free semantic model');
 const pairs=validateAlternateMiningQueue(queue,{limit});
 const ids=[...new Set(pairs.flat())];
 const {rows}=ids.length?await pool.query(ALTERNATE_REVIEW_CURRENT_SQL,[ids]):{rows:[]};
 const current=new Map(rows.map(r=>[r.observation_id,r]));
 const modelKey=EMBEDDING_MODEL+'+'+reviewerModel+'+'+SEMANTIC_REVIEW_POLICY_VERSION;
 const results=[];
 for(const [leftId,rightId] of pairs){
  const a=current.get(leftId),b=current.get(rightId);
  const submitted=queue.pairs.find(item=>[item.left.id,item.right.id].sort().join('|')===leftId+'|'+rightId);
  const expected=new Map([[submitted.left.id,submitted.left.runId],[submitted.right.id,submitted.right.runId]]);
  if(!a||!b||a.run_id!==expected.get(leftId)||b.run_id!==expected.get(rightId)){
   results.push({left:leftId,right:rightId,status:'stale_or_unverified'});continue;
  }
  if((a.thread_root_id||a.observation_id)===(b.thread_root_id||b.observation_id)){
   results.push({left:leftId,right:rightId,status:'same_original_discussion'});continue;
  }
  const params=[a.run_id,a.observation_id,b.run_id,b.observation_id,modelKey];
  const old=await pool.query(priorSQL,params);
  if(old.rows[0]&&old.rows[0].verdict!=='error'){
   results.push({left:leftId,right:rightId,status:'cached',verdict:old.rows[0].verdict});continue;
  }
  let verdict;
  try{
   verdict=await judge({left_id:leftId,right_id:rightId,
    left_statement:a.statement,left_excerpt:a.excerpt,
    right_statement:b.statement,right_excerpt:b.excerpt},
    {env:{...process.env,PIE_LLM_PROVIDER:'openrouter',PIE_LLM_MODEL:reviewerModel}});
   if(!['same_problem','different_problem','uncertain'].includes(verdict?.verdict)||
    typeof verdict.rationale!=='string'||!verdict.rationale.trim())throw Error('Invalid semantic reviewer verdict');
  }catch(error){results.push({left:leftId,right:rightId,status:'error',error:String(error?.message||error).slice(0,180)});continue;}
  // Confirm the source snapshot has not changed during the remote LLM call.
  const recheck=await pool.query(ALTERNATE_REVIEW_CURRENT_SQL,[[leftId,rightId]]);
  const now=new Map(recheck.rows.map(x=>[x.observation_id,x.run_id]));
  if(now.get(leftId)!==a.run_id||now.get(rightId)!==b.run_id){
   results.push({left:leftId,right:rightId,status:'stale_during_review'});continue;
  }
  await pool.query(saveSQL,[...params,verdict.verdict,verdict.rationale.slice(0,240)]);
  results.push({left:leftId,right:rightId,status:'reviewed',verdict:verdict.verdict});
 }
 return {kind:'audited_alternate_semantic_review',retrievalModel:queue.model,
  model:reviewerModel,policy:SEMANTIC_REVIEW_POLICY_VERSION,
  independentHumanLabels:false,marketDemand:'unknown',
  reviewed:results.filter(r=>r.status==='reviewed').length,
  cached:results.filter(r=>r.status==='cached').length,
  errors:results.filter(r=>r.status==='error').length,
  sameProblem:results.filter(r=>r.verdict==='same_problem').length,
  differentProblem:results.filter(r=>r.verdict==='different_problem').length,
  uncertain:results.filter(r=>r.verdict==='uncertain').length,
  results};
}
if(process.argv[1]?.endsWith('/packages/agents/review-alternate-pairs.mjs')){
 const source=process.argv[2];
 if(!source)throw Error('Usage: npm run research:review-alternate -- /private/mined-pairs.json');
 const queue=JSON.parse(await readFile(source,'utf8'));
 const pool=createPool();try{
  const result=await reviewAlternatePairs(pool,queue,{limit:Number(process.env.PIE_ALTERNATE_REVIEW_LIMIT||6)});
  const destination=process.env.PIE_ALTERNATE_REVIEW_REPORT_PATH;
  if(destination)await writeFile(destination,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(result,null,2));
  if(result.errors)process.exitCode=1;
 }finally{await pool.end();}
}
