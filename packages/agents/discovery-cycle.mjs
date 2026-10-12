import {createPool} from '../storage/postgres.mjs';
import {runTargetedDiscovery,validateResearchQuery} from '../ingestion/targeted.mjs';
import {verifiedBatchExtractLLM} from './batch-llm.mjs';
import {extractWithLLM,resolveLLMConfig} from './llm.mjs';
import {verifyWithLLM} from './verify.mjs';
import {persistVerifiedRun} from '../storage/model-runs.mjs';
import {storeEmbeddings} from './embed.mjs';
import {runCorroboration,verifyProblemPair} from './corroborate.mjs';

export const CURRENT_SOURCE_DECISIONS_SQL=`
SELECT o.id,o.content_hash,
       latest.status,latest.source_content_hash
FROM observations o
LEFT JOIN LATERAL (
 SELECT md.status,md.source_content_hash
 FROM model_decisions md JOIN model_runs run ON run.id=md.run_id
 WHERE md.observation_id=o.id
 ORDER BY run.started_at DESC,run.id DESC LIMIT 1
) latest ON TRUE
WHERE o.id=ANY($1::text[])`;

export function classifyPendingObservations(ids,rows){
 if(!Array.isArray(ids)||!Array.isArray(rows))throw new TypeError('Expected discovered IDs and stored observations');
 const byId=new Map(rows.map(row=>[row.id,row]));
 const seen=new Set(),pending=[],previouslyReviewed=[],missing=[];
 for(const id of ids){
  if(seen.has(id))continue;
  seen.add(id);
  const row=byId.get(id);
  if(!row){missing.push(id);continue;}
  const sameSource=row.source_content_hash?.trim()===row.content_hash?.trim();
  if(sameSource&&['found','rejected','none'].includes(row.status))previouslyReviewed.push(id);
  else pending.push(id);
 }
 return {pending,previouslyReviewed,missing};
}

export async function findPendingObservations(pool,ids){
 if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!id.trim()))throw Error('Invalid discovered IDs');
 if(!ids.length)return {pending:[],previouslyReviewed:[],missing:[]};
 const {rows}=await pool.query(CURRENT_SOURCE_DECISIONS_SQL,[[...new Set(ids)]]);
 return classifyPendingObservations(ids,rows);
}

/**
 * Interleave new candidates by reporting surface rather than letting
 * GitHub search results consume the entire LLM budget before any HN comment
 * is considered. This does NOT promote comments to independent discussions.
 */
export function selectDiverseDiscoveryCandidates(ids,types={},limit=6){
 if(!Array.isArray(ids)||!Number.isInteger(limit)||limit<1||limit>20)throw Error('Invalid candidate selection');
 const order=['hackernews_comment','github_issue','hackernews_story','other'];
 const groups=new Map(order.map(t=>[t,[]])),seen=new Set();
 for(const id of ids){
  if(typeof id!=='string'||!id||seen.has(id))continue;
  seen.add(id);
  const inferred=id.startsWith('github:')?'github_issue':id.startsWith('hackernews:')?'hackernews_story':'other';
  const group=groups.has(types[id])?types[id]:inferred;
  groups.get(group).push(id);
 }
 const chosen=[];
 while(chosen.length<limit){
  let changed=false;
  for(const type of order){
   if(chosen.length>=limit)break;
   const next=groups.get(type).shift();
   if(next){chosen.push(next);changed=true;}
  }
  if(!changed)break;
 }
 return chosen;
}
/**
 * Bounded discovery cycle:
 * public source search -> source-revision aware triage -> LLM evidence screening
 * -> persisted decisions -> local embeddings -> scoped semantic pairing.
 *
 * A cycle NEVER infers demand or distinct humans from multiple publications.
 * Injectable seams allow full test coverage without paid APIs.
 */
export async function runDiscoveryCycle(pool,query,{
 perSource=8,maxAnalyze=6,maxPairs=10,similarityThreshold=0.55,includeHNComments=false,
 model='nvidia/nemotron-3.5-lightning:free',env=process.env,
 discovery=runTargetedDiscovery,pendingLookup=findPendingObservations,
 analyze=verifiedBatchExtractLLM,persist=persistVerifiedRun,
 embed=storeEmbeddings,corroborate=runCorroboration
}={}){
 query=validateResearchQuery(query);
 if(!Number.isInteger(perSource)||perSource<1||perSource>40)throw RangeError('Invalid perSource');
 if(!Number.isInteger(maxAnalyze)||maxAnalyze<1||maxAnalyze>20)throw RangeError('Invalid maxAnalyze');
 if(!Number.isInteger(maxPairs)||maxPairs<1||maxPairs>30)throw RangeError('Invalid maxPairs');
 if(!Number.isFinite(similarityThreshold)||similarityThreshold<0||similarityThreshold>1)throw RangeError('Invalid similarity threshold');
 if(!model.endsWith(':free'))throw Error('Discovery only accepts free OpenRouter models');
 const llmEnv={...env,PIE_LLM_PROVIDER:'openrouter',PIE_LLM_MODEL:model};
 const config=resolveLLMConfig(llmEnv);
 if(!config.apiKey)throw Error('Missing OpenRouter key; no discovery requests made');

 const search=await discovery(pool,query,{perSource,includeHNComments});
 const selection=await pendingLookup(pool,search.observationIds);
 const selected=selectDiverseDiscoveryCandidates(selection.pending,search.observationTypes||{},maxAnalyze);
 const summary={
  query,model,sourceSearch:search,
  pendingBeforeLimit:selection.pending.length,
  alreadyReviewed:selection.previouslyReviewed.length,
  missingSources:selection.missing,
  deferredByBudget:selection.pending.length-selected.length,
  observationIdsAnalyzed:selected,
  extraction:{total:0,found:0,rejected:0,none:0,error:0,recovered:0},
  history:null,embeddings:null,
  corroboration:null,commercialValidation:'unknown',
  isIndependentDemandEstablished:false
 };
 if(!selected.length)return summary;

 const {raw,verified}=await analyze(pool,{
  observationIds:selected,limit:maxAnalyze,
  extract:(row,options)=>extractWithLLM(row,{...options,env:llmEnv}),
  judge:(row,candidate)=>verifyWithLLM(row,candidate,{env:llmEnv})
 });
 summary.extraction={
  total:verified.total,found:verified.found,rejected:verified.rejected,
  none:verified.none,error:verified.error,recovered:raw.recovered||0
 };
 summary.history=await persist(pool,verified,{provider:'openrouter',model});
 const found=verified.results.filter(row=>row.status==='found').map(row=>row.observationId);
 if(found.length){
  summary.embeddings=await embed(pool,{limit:300});
  // Run semantic comparisons only when source-backed findings were embedded.
  if(!summary.embeddings.errors){
   const review=await corroborate(pool,{
    observationIds:found,maxPairs,threshold:similarityThreshold,reviewerModel:model,
    judge:pair=>verifyProblemPair(pair,{env:llmEnv})
   });
   summary.corroboration={
    pairsEvaluated:review.pairsEvaluated,cachedPairs:review.cachedPairs||0,
    sameProblem:review.verifiedSameProblem,differentProblem:review.rejectedPairs,
    uncertain:review.uncertain,errors:review.errors,
    groups:review.groups.filter(group=>group.members.some(m=>found.includes(m.observationId))&&group.observationCount>1)
   };
  }
 }
 return summary;
}

if(process.argv[1]?.endsWith('/packages/agents/discovery-cycle.mjs')){
 const query=process.argv.slice(2).join(' ').trim()||process.env.PIE_TARGET_QUERY;
 if(!query)throw Error('Usage: npm run discovery:cycle -- "specific public problem query"');
 const pool=createPool();
 try{
  const report=await runDiscoveryCycle(pool,query,{
   perSource:Number(process.env.PIE_DISCOVERY_PER_SOURCE||8),
   maxAnalyze:Number(process.env.PIE_DISCOVERY_MAX_ANALYZE||6),
   maxPairs:Number(process.env.PIE_DISCOVERY_MAX_PAIRS||10),
   similarityThreshold:Number(process.env.PIE_DISCOVERY_SIMILARITY||0.55),
   includeHNComments:process.env.PIE_INCLUDE_HN_COMMENTS==='1'
  });
  console.log('DISCOVERY_CYCLE',JSON.stringify(report,null,2));
  if(report.sourceSearch.incomplete||report.extraction.error||report.embeddings?.errors||report.corroboration?.errors)process.exitCode=1;
 }finally{await pool.end();}
}
