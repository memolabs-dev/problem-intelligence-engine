import {clusterProblems} from './cluster.mjs';

/**
 * Build a traceable, conservative view of verified problems.
 * "Verified" means an exact source quote and a passing extraction reviewer,
 * NOT proof that the quote is true, independently reported, or commercially valuable.
 */
export function buildEvidenceGraph(report,observations,{similarityThreshold=0.6}={}){
 if(!Array.isArray(report?.results)||!Array.isArray(observations))throw new TypeError('Expected a report and observations');
 const byId=new Map();
 for(const observation of observations){
  if(typeof observation?.id!=='string'||!observation.id||byId.has(observation.id))throw new Error('Invalid or duplicate observation');
  byId.set(observation.id,observation);
 }
 const found=[],issues=[],seen=new Set(),counts={found:0,rejected:0,none:0,error:0};
 for(const item of report.results){
  if(typeof item?.observationId!=='string'||seen.has(item.observationId)||!Object.hasOwn(counts,item.status))throw new Error('Invalid or duplicate extraction result');
  seen.add(item.observationId);counts[item.status]++;
  if(item.status!=='found')continue;
  const observation=byId.get(item.observationId);
  const candidate=item.candidate;
  if(!observation){issues.push({observationId:item.observationId,reason:'source_missing'});continue;}
  if(typeof candidate?.statement!=='string'||candidate.statement.trim().length<12||typeof candidate?.excerpt!=='string'||candidate.excerpt.trim().length<12){issues.push({observationId:item.observationId,reason:'invalid_candidate'});continue;}
  const sourceText=`${observation.title||''}\n${observation.body||''}`;
  if(!sourceText.includes(candidate.excerpt)){issues.push({observationId:item.observationId,reason:'quote_not_in_source'});continue;}
  if(typeof candidate.sourceUrl==='string'&&candidate.sourceUrl!==observation.url){issues.push({observationId:item.observationId,reason:'source_url_mismatch'});continue;}
  if(item.verification?.accept!==true){issues.push({observationId:item.observationId,reason:'unverified_candidate'});continue;}
  found.push({statement:candidate.statement,observationId:item.observationId,sourceUrl:observation.url,source:observation.source??item.observationId.split(':')[0],excerpt:candidate.excerpt,category:item.verification.category??null,reportedBy:observation.reporter_key||observation.reporterKey||null});
 }
 const clusters=clusterProblems(found,{threshold:similarityThreshold});
 const problems=clusters.map((cluster,index)=>{
  const members=cluster.members;
  const observationsIds=[...new Set(members.map(m=>m.observationId))].sort();
  const urls=[...new Set(members.map(m=>m.sourceUrl))].sort();
  const platforms=[...new Set(members.map(m=>m.source))].sort();
  const reporterIds=members.map(m=>m.reportedBy);
  const identitiesKnown=reporterIds.every(Boolean);
  const uniqueReporters=identitiesKnown?new Set(reporterIds).size:null;
  const multipleReports=observationsIds.length>1;
  const corroboration=!multipleReports?'single_observation':identitiesKnown&&uniqueReporters>1?'multiple_distinct_accounts_independence_unverified':'multiple_observations_reporter_independence_unknown';
  return {
   id:`group-${index+1}`,statement:cluster.representative,observationCount:observationsIds.length,sourceUrlCount:urls.length,platformCount:platforms.length,
   distinctReporterAccountCount:uniqueReporters,verifiedIndependentReporterCount:null,
   corroboration,commercialValidation:'unknown',marketRelevance:'not_assessed',paymentEvidence:'unknown',
   observations:observationsIds,sources:platforms,
   evidence:members.map(m=>({observationId:m.observationId,url:m.sourceUrl,source:m.source,excerpt:m.excerpt,qualification:m.category})).sort((a,b)=>a.observationId.localeCompare(b.observationId))
  };
 });
 return {observationsReceived:observations.length,status:counts,validCandidates:found.length,invalidCandidates:issues,clusterCount:problems.length,problems};
}

export async function buildStoredEvidenceGraph(pool,report,options={}){
 const ids=[...new Set((report?.results||[]).filter(item=>item.status==='found').map(item=>item.observationId))];
 if(!ids.length)return buildEvidenceGraph(report,[],options);
 const {rows}=await pool.query('SELECT id,title,body,url,source,reporter_key FROM observations WHERE id=ANY($1::text[])',[ids]);
 return buildEvidenceGraph(report,rows,options);
}
