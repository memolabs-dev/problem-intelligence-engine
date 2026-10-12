/**
 * Conservative source-origin screen: an issue roundup may describe a real bug
 * but the roundup author is not a direct reporter of that bug. Preserve it as
 * a lead to the ORIGINAL source rather than treating it as an independent
 * firsthand report.
 */
export const PROVENANCE_POLICY_VERSION='source-provenance-v1';
const SECONDARY_TITLE=/(?:\b(?:weekly|monthly|daily|community|tools|issues?|news|ai[ -]?cli)\s+(?:digest|roundup|bulletin)\b|\bdigest\b.{0,35}\b20\d{2}[-/]\d{2}[-/]\d{2}\b)/i;

export function classifySourceProvenance(observation){
 if(!observation||typeof observation.title!=='string')throw Error('Source title required for provenance');
 const title=observation.title.trim();
 if(SECONDARY_TITLE.test(title))return {
  kind:'secondary_digest',directReport:false,
  reason:'Aggregate digest or news roundup references other reports; inspect the original linked issue before counting firsthand evidence.'
 };
 return {kind:'unassessed_primary_or_other',directReport:null,reason:null};
}
export function provenanceRejection(observation){
 const status=classifySourceProvenance(observation);
 return status.kind==='secondary_digest'?{
  accept:false,category:'unsupported',method:'deterministic-source-provenance',
  sourceRole:status.kind,reason:status.reason
 }:null;
}
