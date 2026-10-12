import {assess} from './score.mjs';

// Separate ranking readiness from commercial validation. A supported quote
// proves a report exists; it does not prove independent demand or payment.
export function assessOpportunity({factors={},evidence=[]}={}){
 const result=assess(factors);
 if(!Array.isArray(evidence))throw new TypeError('Evidence must be an array');
 const distinct=new Map();
 for(const item of evidence){
  if(typeof item?.url!=='string'||!item.url)continue;
  const current=distinct.get(item.url);
  // Prefer an anchored evidence item over a duplicate unverified mention.
  if(!current||(item.verified===true&&current.verified!==true))distinct.set(item.url,item);
 }
 const unique=[...distinct.values()];
 const sources=new Set(unique.map(e=>e.source).filter(Boolean));
 const anchored=unique.filter(e=>e.verified===true&&typeof e.excerpt==='string'&&e.excerpt.trim().length>=12);
 const payment=anchored.filter(e=>e.evidenceType==='payment_intent');
 const knownAccounts=anchored.map(e=>e.reporterKey).filter(Boolean);
 const allAccountsKnown=anchored.length>0&&knownAccounts.length===anchored.length;
 const accountCount=allAccountsKnown?new Set(knownAccounts).size:null;
 const repeated=anchored.length>1;
 const corroboration=!repeated?'single_or_no_anchored_observation':accountCount!=null&&accountCount>1?'multiple_distinct_accounts_unverified_independence':'multiple_observations_unverified_independence';
 const researchEligible=result.coverage>=20&&anchored.length>=1;
 const commercialEligible=result.coverage>=70&&factors.payment!=null&&payment.length>=1&&anchored.length>=2&&accountCount!=null&&accountCount>=2;
 return {
  ...result,
  verifiedEvidenceCount:anchored.length,
  evidenceCount:unique.length,
  independentSourceCount:sources.size,
  distinctReporterAccountCount:accountCount,
  explicitPaymentEvidenceCount:payment.length,
  corroboration,
  commercialValidation:payment.length===0?'unknown':'requires-human-review',
  eligibleForExploration:researchEligible,
  eligibleForRanking:commercialEligible
 };
}
