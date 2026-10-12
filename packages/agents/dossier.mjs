import {createPool} from '../storage/postgres.mjs';
import {EMBEDDING_MODEL} from './embed.mjs';
import {SEMANTIC_REVIEW_POLICY_VERSION} from './corroborate.mjs';

export const CURRENT_DOSSIER_ROOT_SQL=`
WITH latest AS (
 SELECT md.run_id,md.observation_id,md.status,md.statement,md.excerpt,md.qualification,
 md.source_content_hash,row_number() OVER (
 PARTITION BY md.observation_id ORDER BY r.started_at DESC,r.id DESC
 ) AS rn
 FROM model_decisions md JOIN model_runs r ON r.id=md.run_id
)
SELECT l.run_id,l.observation_id,l.statement,l.excerpt,l.qualification,
 o.title,o.source,o.url,o.reporter_key,o.thread_root_id
FROM latest l JOIN observations o ON o.id=l.observation_id
WHERE l.rn=1 AND l.observation_id=$1 AND l.status='found'
AND l.source_content_hash=o.content_hash`;

export const VERIFIED_RELATED_DOSSIER_SQL=`
WITH related AS (
 SELECT CASE WHEN e.left_observation=$1 THEN e.right_observation ELSE e.left_observation END AS related_id,
 CASE WHEN e.left_observation=$1 THEN e.right_run ELSE e.left_run END AS related_run,
 e.rationale
 FROM corroboration_edges e
 WHERE ((e.left_observation=$1 AND e.left_run=$2) OR (e.right_observation=$1 AND e.right_run=$2))
 AND e.model=$3 AND e.verdict='same_problem'
)
SELECT DISTINCT ON (o.id)
 o.id,o.title,o.source,o.url,o.reporter_key,o.thread_root_id,
 linked.statement,linked.excerpt,related.rationale
FROM related
JOIN observations o ON o.id=related.related_id
JOIN model_decisions linked ON linked.observation_id=o.id AND linked.run_id=related.related_run
WHERE linked.status='found' AND linked.source_content_hash=o.content_hash
AND linked.run_id=(
 SELECT md.run_id FROM model_decisions md JOIN model_runs r ON r.id=md.run_id
 WHERE md.observation_id=o.id ORDER BY r.started_at DESC,r.id DESC LIMIT 1
)
ORDER BY o.id`;

export const VERIFIED_DOSSIER_THREAD_SQL=`
SELECT m.author_key,s.verdict,s.excerpt
FROM conversation_support s
JOIN conversation_messages m ON m.id=s.message_id
WHERE s.observation_id=$1 AND s.run_id=$2 AND s.model=$3
AND s.verdict IN ('firsthand_same_problem','agreement_only')
AND s.excerpt IS NOT NULL AND position(s.excerpt in m.body)>0`;

export function assembleDossier(root,related,threadSignals){
 if(!root||typeof root.statement!=='string'||typeof root.excerpt!=='string'||!root.url?.startsWith('https://'))throw Error('No current verified, source-grounded problem');
 if(!Array.isArray(related)||!Array.isArray(threadSignals))throw Error('Expected dossier evidence arrays');
 const unique=new Map();
 for(const row of related){
  if(row.id===root.observation_id||!row.id||!row.url?.startsWith('https://')||typeof row.excerpt!=='string')continue;
  if(!unique.has(row.id))unique.set(row.id,row);
 }
 const links=[...unique.values()];
 const accountKeys=[root.reporter_key,...links.map(row=>row.reporter_key)];
 const accountsComplete=accountKeys.every(Boolean);
 const distinctAccounts=accountsComplete?new Set(accountKeys).size:null;
 const discussionRoots=new Set([root.thread_root_id||root.observation_id,...links.map(row=>row.thread_root_id||row.id)]);
 const firsthand=new Set(),agreement=new Set();
 for(const row of threadSignals){
  if(!row.author_key||root.reporter_key===row.author_key||typeof row.excerpt!=='string'||row.excerpt.length<12)continue;
  if(row.verdict==='firsthand_same_problem')firsthand.add(row.author_key);
  if(row.verdict==='agreement_only')agreement.add(row.author_key);
 }
 return {
  observationId:root.observation_id,
  problem:root.statement,
  category:root.qualification||'unclassified',
  evidence:{source:root.source,url:root.url,title:root.title,excerpt:root.excerpt},
  corroboration:{
   sameProblemObservations:links.length+1,
   distinctSourceDiscussions:discussionRoots.size,
   distinctKnownSourceAccounts:distinctAccounts,
   independentlyVerifiedPeople:null,
   duplicatePostsByRootAccount:root.reporter_key?links.filter(x=>x.reporter_key===root.reporter_key).length:0,
   reports:links.map(row=>({
    observationId:row.id,problem:row.statement,evidence:{source:row.source,url:row.url,excerpt:row.excerpt},
    sameSourceAccountAsRoot:root.reporter_key&&row.reporter_key?root.reporter_key===row.reporter_key:null,
    reviewerRationale:row.rationale||null
   }))
  },
  discussion:{
   reportedFirsthandAccounts:firsthand.size,agreementOnlyAccounts:agreement.size,
   independentSourceThreadsAdded:0,
   independentlyVerifiedPeople:null
  },
  commercialValidation:'unknown',
  paymentEvidence:'not_assessed',
  assessment:'model-screened evidence, not a validated market opportunity'
 };
}
export async function buildProblemDossier(pool,id,{reviewerModel='nvidia/nemotron-3.5-lightning:free'}={}){
 if(typeof id!=='string'||!/^(?:github|hackernews):[A-Za-z0-9_-]+$/.test(id))throw Error('Invalid source observation ID');
 const {rows:roots}=await pool.query(CURRENT_DOSSIER_ROOT_SQL,[id]);
 const root=roots[0];
 if(!root)throw Error('No current verified, source-grounded problem for '+id);
 const modelKey=EMBEDDING_MODEL+'+'+reviewerModel+'+'+SEMANTIC_REVIEW_POLICY_VERSION;
 const {rows:related}=await pool.query(VERIFIED_RELATED_DOSSIER_SQL,[id,root.run_id,modelKey]);
 const {rows:threads}=await pool.query(VERIFIED_DOSSIER_THREAD_SQL,[id,root.run_id,reviewerModel]);
 return assembleDossier(root,related,threads);
}
if(process.argv[1]?.endsWith('/packages/agents/dossier.mjs')){
 const id=process.argv[2];
 if(!id)throw Error('Usage: npm run problems:dossier -- github:<observationId>');
 const pool=createPool();
 try{console.log(JSON.stringify(await buildProblemDossier(pool,id),null,2));}
 finally{await pool.end();}
}
