import {normalizeGithubIssue} from '../connectors/github.mjs';
import {normalizeHackerNews} from '../connectors/hackernews.mjs';
import {saveObservations,createPool} from '../storage/postgres.mjs';
import {saveTargetedSearchAudit} from '../storage/targeted-audit.mjs';

/** A search hit is only a lead for extraction, never a verified problem. */
export function validateResearchQuery(query){
 if(typeof query!=='string')throw new TypeError('Expected a text query');
 const normalized=query.replace(/\s+/g,' ').trim();
 if(normalized.length<8||normalized.length>180)throw Error('Research query must be 8..180 characters');
 return normalized;
}
function perSourceLimit(limit){
 if(!Number.isInteger(limit)||limit<1||limit>40)throw RangeError('Per-source result limit must be 1..40');
 return limit;
}
export async function explainGitHubSearchFailure(response){
 const remaining=response?.headers?.get?.('x-ratelimit-remaining');
 const retryAfter=Number(response?.headers?.get?.('retry-after'));
 let apiMessage='';
 if(response.status===403){
  try{apiMessage=String((await response.json())?.message||'').slice(0,300);}
  catch{ /* GitHub may reject with an empty body. */ }
 }
 const limited=response.status===429||(response.status===403&&(
  remaining==='0'||Number.isFinite(retryAfter)&&retryAfter>0||
  /(?:secondary )?rate limit exceeded|API rate limit/i.test(apiMessage)
 ));
 const error=new Error(limited
  ?'GitHub search rate limit reached; results are incomplete. Configure GITHUB_TOKEN or retry later.'
  :'GitHub search HTTP '+response.status);
 error.code=limited?'rate_limited':'http_error';
 error.httpStatus=response.status;
 if(limited&&Number.isFinite(retryAfter)&&retryAfter>0)error.retryAfterSeconds=Math.min(Math.ceil(retryAfter),3600);
 return error;
}
export async function searchPublicGitHub(query,{fetcher=fetch,limit=10,token}={}){
 query=validateResearchQuery(query);perSourceLimit(limit);
 const q=encodeURIComponent(query+' in:title,body is:issue');
 const url=`https://api.github.com/search/issues?q=${q}&sort=updated&order=desc&per_page=${limit}`;
 const headers={Accept:'application/vnd.github+json','User-Agent':'problem-intelligence-engine'};
 if(token)headers.Authorization='Bearer '+token;
 const response=await fetcher(url,{headers,signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw await explainGitHubSearchFailure(response);
 const data=await response.json();
 if(!Array.isArray(data.items))throw Error('Invalid GitHub search response');
 return data.items.slice(0,limit).map(normalizeGithubIssue).filter(Boolean);
}
export async function searchPublicHackerNews(query,{fetcher=fetch,limit=10}={}){
 query=validateResearchQuery(query);perSourceLimit(limit);
 const url=`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;
 const response=await fetcher(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error('Hacker News search HTTP '+response.status);
 const data=await response.json();
 if(!Array.isArray(data.hits))throw Error('Invalid Hacker News search response');
 return data.hits.slice(0,limit).map(hit=>normalizeHackerNews({
  id:hit.objectID,type:'story',title:hit.title||hit.story_title||'',text:hit.story_text||'',by:hit.author||null,time:hit.created_at_i||null
 })).filter(Boolean);
}
export async function runTargetedDiscovery(pool,query,{fetcher=fetch,perSource=10,token=process.env.GITHUB_TOKEN,persist=saveObservations,audit=saveTargetedSearchAudit}={}){
 query=validateResearchQuery(query);perSourceLimit(perSource);
 const attempts=await Promise.allSettled([
  searchPublicGitHub(query,{fetcher,limit:perSource,token}),
  searchPublicHackerNews(query,{fetcher,limit:perSource})
 ]);
 const names=['github','hackernews'];
 const statuses=attempts.map((attempt,index)=>attempt.status==='fulfilled'
  ?{source:names[index],status:'ok',fetched:attempt.value.length}
  :{source:names[index],status:'error',reason:attempt.reason?.code||'provider_error',
    ...(attempt.reason?.retryAfterSeconds?{retryAfterSeconds:attempt.reason.retryAfterSeconds}:{}),
    error:String(attempt.reason?.message||attempt.reason).slice(0,160)});
 const observations=attempts.flatMap(x=>x.status==='fulfilled'?x.value:[]);
 const unique=[...new Map(observations.map(o=>[o.id,o])).values()];
 if(unique.length)await persist(pool,unique);
 const accounts=unique.map(o=>o.reporterKey).filter(Boolean);
 const report={
  query,matchedRaw:observations.length,uniqueObservations:unique.length,sources:statuses,
  knownAccountObservations:accounts.length,distinctSourceAccounts:new Set(accounts).size,
  repeatedPostsFromKnownAccounts:accounts.length-new Set(accounts).size,
  verifiedIndependentHumans:null,
  incomplete:statuses.some(x=>x.status!=='ok'),qualification:'unreviewed_source_observations',
  observationIds:unique.map(o=>o.id)
 };
 if(pool?.connect)report.searchRunId=await audit(pool,report,unique);
 return report;
}
if(process.argv[1]?.endsWith('/packages/ingestion/targeted.mjs')){
 const query=process.argv.slice(2).join(' ').trim()||process.env.PIE_TARGET_QUERY;
 if(!query)throw Error('Usage: npm run discover:search -- "describe a specific difficulty"');
 const pool=createPool();
 try{
  const report=await runTargetedDiscovery(pool,query,{perSource:Number(process.env.PIE_DISCOVERY_PER_SOURCE||10)});
  console.log(JSON.stringify(report,null,2));
  if(report.incomplete)process.exitCode=1;
 }finally{await pool.end();}
}
