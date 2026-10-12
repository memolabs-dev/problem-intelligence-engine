import {randomUUID} from 'node:crypto';
import {createPool} from '../storage/postgres.mjs';
import {runDiscoveryCycle} from './discovery-cycle.mjs';

export const RECURRENCE_PLANNER_VERSION='source-recurrence-probes-v3';
export const CURRENT_SEED_PROBLEMS_SQL=`
WITH ranked AS (
 SELECT md.observation_id,md.status,md.statement,md.source_content_hash,
 row_number() OVER(PARTITION BY md.observation_id ORDER BY r.started_at DESC,r.id DESC) AS rn
 FROM model_decisions md JOIN model_runs r ON r.id=md.run_id
)
SELECT m.observation_id AS id,m.statement,o.title,o.url,o.source,o.reporter_key,
       o.content_hash
FROM ranked m JOIN observations o ON o.id=m.observation_id
WHERE m.rn=1 AND m.status='found' AND m.source_content_hash=o.content_hash
 AND (cardinality($1::text[])=0 OR m.observation_id=ANY($1::text[]))
ORDER BY md5(m.observation_id || $3)
LIMIT $2`;

const STOPWORDS=new Set(`
the and with this that from have over when into under will be are were where
while between their these those through such using used uses cause caused causes
cannot cant failed fails failure issue problem bug error users user affects
regression results runtime support during after because missing expected
instead actual multiple code tests build works does dont should would could
work working not same every only there then about being which these say said lots module
files file path version project new old command output method function
`.split(/\s+/).filter(Boolean));
function tokens(input){
 const matches=String(input||'').match(/[\p{L}\p{N}][\p{L}\p{N}_:./-]*/gu)||[];
 const seen=new Set();
 return matches.map(x=>x.replace(/^[./:-]+|[./:-]+$/g,''))
   .filter(x=>x.length>=3&&x.length<=55&&!STOPWORDS.has(x.toLowerCase())&&!/^\d+(?:\.\d+)*$/.test(x))
   .filter(x=>{const k=x.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;});
}
function codeIdentifiers(input){
 const str=String(input||'');
 const literals=[...str.matchAll(/`([^`]{3,70})`/g)].map(m=>m[1].trim()).filter(x=>!x.includes(' ')&&x.length>=3);
 const flags=(str.match(/--[a-z][a-z0-9-]{2,}/gi)||[]);
 const camel=(str.match(/\b[a-z]+[A-Z][A-Za-z0-9]+\b/g)||[]);
 return [...new Set([...literals,...flags,...camel])].filter(x=>x.length<=55);
}
function uniqueQueries(items,maxQueries){
 const seen=new Set(),result=[];
 for(const text of items){
  const q=String(text||'').replace(/\s+/g,' ').trim();
  if(q.length<8||q.length>130||seen.has(q.toLowerCase()))continue;
  seen.add(q.toLowerCase());result.push(q);
  if(result.length>=maxQueries)break;
 }
 return result;
}
/**
 * Deterministic, lexical search plans. Search strings are DISCOVERY probes,
 * not model labels or ungrounded problem assertions.
 */
export function buildRecurrenceQueries(seed,{maxQueries=2}={}){
 if(!seed?.id||typeof seed.title!=='string'||typeof seed.statement!=='string')throw Error('A verified source seed is required');
 if(!Number.isInteger(maxQueries)||maxQueries<1||maxQueries>3)throw RangeError('Invalid query count');
 const title=tokens(seed.title),statement=tokens(seed.statement);
 const ids=codeIdentifiers(seed.title+' '+seed.statement);
 const tech=[...title,...statement].find(x=>/^(?:deno|node(?:\\.js)?|bun|next\\.js|turbopack|postgres(?:ql)?|react|webpack|javascript|typescript|v8|csv)$/i.test(x));
 const identifier=ids.find(x=>/[a-z][A-Z]|[_.:/-]/.test(x))||null;
 const protocol=title.find(x=>/^(?:tls|ssl|tcp|udp|oauth|utf-?8|utf-?16|websocket)$/i.test(x)) || title.find(x=>/^(?:https?|ack(?:ed)?)$/i.test(x));
 const symptom=title.find(x=>/^(?:hangs?|stalls?|crashes?|fails?|broken|unreffed|ignores?|ignored|missing|leaks?|regression|deadlock|timeout|slow|frozen|drops?|lost|aborts?)$/i.test(x));
 const secondarySignal=title.find(x=>/^(?:acked|acknowledged|keep-alive|websocket)$/i.test(x)&&x!==protocol) || title.find(x=>/[A-Z]{2,}|[a-z][A-Z]/.test(x)&&x!==protocol&&x!==tech&&x!==identifier);
 const fallback=title.find(x=>x.length>=5&&!/^(?:until|despite|after|before|since|while|during|working|using|client|process|without|cannot|across|through)$/i.test(x));
 const uniq=items=>[...new Map(items.filter(Boolean).map(x=>[x.toLowerCase(),x])).values()];
 // GitHub issue search ANDs each term. More keywords can REMOVE the actual
 // recurrence; keep each search at 2–4 discriminative anchors, not long prose.
 const primary=uniq([tech,identifier,protocol,secondarySignal,symptom,fallback,...statement]).slice(0,4).join(' ');
 const alternate=uniq([tech,identifier,protocol,symptom,fallback,...statement]).slice(0,3).join(' ');
 const semantic=uniq([tech,identifier,...statement.filter(x=>x.length>5),symptom,...title]).slice(0,3).join(' ');
 return uniqueQueries([primary,alternate,semantic],maxQueries);
}
export async function loadVerifiedSeeds(pool,{observationIds=[],maxSeeds=3}={}){
 if(!Array.isArray(observationIds)||observationIds.length>8||observationIds.some(id=>typeof id!=='string'||!/^(github|hackernews):/.test(id)))throw Error('Invalid seed IDs');
 if(!Number.isInteger(maxSeeds)||maxSeeds<1||maxSeeds>8)throw RangeError('Invalid seed limit');
 const {rows}=await pool.query(CURRENT_SEED_PROBLEMS_SQL,[[...new Set(observationIds)],maxSeeds,'recurrence-planner-v1']);
 if(observationIds.length){
  const found=new Set(rows.map(row=>row.id));
  const missing=observationIds.filter(id=>!found.has(id));
  if(missing.length)throw Error('No source-current verified seed for '+missing.join(','));
 }
 return rows;
}
export async function saveRecurrenceProbe(pool,{seed,query,result,status}){
 if(!['completed','partial','error'].includes(status)||!seed?.id||!seed.content_hash||!query)throw Error('Invalid recurrence probe audit');
 const brief={
  sourceHits:result?.sourceSearch?.uniqueObservations??null,
  knownSourceAccounts:result?.sourceSearch?.distinctSourceAccounts??null,
  analyzed:result?.extraction?.total??null,
  verifiedProblems:result?.extraction?.found??null,
  semanticSameProblem:result?.corroboration?.sameProblem??null,
  reviewerErrors:result?.corroboration?.errors??null,
  warning:result?.error??null
 };
 const id=randomUUID();
 await pool.query(`INSERT INTO recurrence_probe_runs
 (id,seed_observation_id,seed_content_hash,query,planner_version,status,search_run_id,result_summary)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
 [id,seed.id,seed.content_hash,query,RECURRENCE_PLANNER_VERSION,status,result?.sourceSearch?.searchRunId??null,JSON.stringify(brief)]);
 return id;
}
export async function runRecurrenceResearch(pool,{
 observationIds=[],maxSeeds=3,maxQueries=2,perSource=5,maxAnalyze=2,maxPairs=5,includeHNComments=true,
 similarityThreshold=0.55,dryRun=false,
 loadSeeds=loadVerifiedSeeds,cycle=runDiscoveryCycle,saveAudit=saveRecurrenceProbe
}={}){
 if(!Number.isInteger(maxSeeds)||maxSeeds<1||maxSeeds>6||
 !Number.isInteger(maxQueries)||maxQueries<1||maxQueries>2||
 !Number.isInteger(perSource)||perSource<1||perSource>10||
 !Number.isInteger(maxAnalyze)||maxAnalyze<1||maxAnalyze>5||
 !Number.isInteger(maxPairs)||maxPairs<1||maxPairs>10||
 !Number.isFinite(similarityThreshold)||similarityThreshold<0||similarityThreshold>1||typeof includeHNComments!=='boolean')
 throw Error('Invalid bounded recurrence budget');
 const seeds=await loadSeeds(pool,{observationIds,maxSeeds});
 const seenQueries=new Set(),plan=[];
 for(const seed of seeds){
  for(const query of buildRecurrenceQueries(seed,{maxQueries})){
   if(seenQueries.has(query.toLowerCase()))continue;
   seenQueries.add(query.toLowerCase());
   plan.push({seed,query});
  }
 }
 const summary={
  planner:RECURRENCE_PLANNER_VERSION,dryRun,budget:{maxSeeds,maxQueries,perSource,maxAnalyze,maxPairs,includeHNComments},
  seeds:seeds.map(seed=>({id:seed.id,source:seed.source})),
  plannedProbes:plan.length,completed:0,partial:0,failed:0,results:[],
  commercialValidation:'unknown',independentDemandEstablished:false
 };
 if(dryRun){
  summary.results=plan.map(({seed,query})=>({seedId:seed.id,query,status:'planned'}));
  return summary;
 }
 for(const {seed,query} of plan){
  let result,status;
  try{
   result=await cycle(pool,query,{perSource,maxAnalyze,maxPairs,similarityThreshold,includeHNComments});
   status=result.sourceSearch?.incomplete||result.extraction?.error||result.corroboration?.errors?'partial':'completed';
  }catch(error){
   status='error';
   result={error:String(error?.message||error).slice(0,240)};
  }
  const record={seedId:seed.id,query,status,
   hits:result?.sourceSearch?.uniqueObservations??null,
   newProblems:result?.extraction?.found??null,
   relatedPairs:result?.corroboration?.sameProblem??null,
   sameAccountPosts:result?.sourceSearch?.repeatedPostsFromKnownAccounts??null,
   error:result.error??null};
  try{record.auditRunId=await saveAudit(pool,{seed,query,result,status});}
  catch(error){record.auditError=String(error.message||error).slice(0,200);status='error';record.status='error';}
  summary.results.push(record);
  if(status==='completed')summary.completed++;
  else if(status==='partial')summary.partial++;
  else summary.failed++;
 }
 return summary;
}
if(process.argv[1]?.endsWith('/packages/agents/recurrence-research.mjs')){
 const pool=createPool();
 try{
  const ids=(process.env.PIE_RECURRENCE_SEED_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
  const report=await runRecurrenceResearch(pool,{
   observationIds:ids,maxSeeds:Number(process.env.PIE_RECURRENCE_MAX_SEEDS||3),
   maxQueries:Number(process.env.PIE_RECURRENCE_QUERIES||2),
   perSource:Number(process.env.PIE_RECURRENCE_PER_SOURCE||5),
   maxAnalyze:Number(process.env.PIE_RECURRENCE_MAX_ANALYZE||2),
   maxPairs:Number(process.env.PIE_RECURRENCE_MAX_PAIRS||5),
   similarityThreshold:Number(process.env.PIE_RECURRENCE_SIMILARITY||0.55),
   dryRun:process.env.PIE_RECURRENCE_DRY_RUN==='1',
   includeHNComments:process.env.PIE_RECURRENCE_INCLUDE_HN_COMMENTS!=='0'
  });
  console.log('RECURRENCE_RESEARCH',JSON.stringify(report,null,2));
  if(report.failed||report.partial)process.exitCode=1;
 }finally{await pool.end();}
}
