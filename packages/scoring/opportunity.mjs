import {assess} from './score.mjs';
// Evidence count is a strength-of-support metric, never a proxy for payment intent.
export function assessOpportunity({factors={},evidence=[]}={}) {
 const result=assess(factors);
 const sources=new Set(evidence.map(e=>e.source).filter(Boolean));
 const urls=new Set(evidence.map(e=>e.url).filter(Boolean));
 return {...result,evidenceCount:urls.size,independentSourceCount:sources.size,commercialValidation:factors.payment==null?'unknown':'requires-human-review',eligibleForRanking:result.coverage>=70&&factors.payment!=null};
}
