/**
 * Conservative source-origin screen: an issue roundup may describe a real bug
 * but the roundup author is not a direct reporter of that bug. Preserve it as
 * a lead to the ORIGINAL source rather than treating it as an independent
 * firsthand report.
 */
export const PROVENANCE_POLICY_VERSION='source-provenance-v1';
const SECONDARY_TITLE=/(?:\b(?:weekly|monthly|daily|community|tools|issues?|news|ai[ -]?cli)\s+(?:digest|roundup|bulletin)\b|\bdigest\b.{0,35}\b20\d{2}[-/]\d{2}[-/]\d{2}\b)/i;

function hasExplicitFirsthandDifficulty(body){
 // HN uses <p> for paragraphs and &gt; for quoted third-party content.
 // Do not let a pasted article's "we" or "I" masquerade as the commenter.
 const blocks=String(body||'').split(/<p(?:\s[^>]*)?>/i);
 const subject=/\b(?:i|i've|i'm|we|we've|our|my|us)\b/i;
 const pain=/\b(?:hallucinat\w*|fail\w*|crash\w*|bug|bottleneck|broken|cannot|can't|couldn't|doesn't|problem\w*|issue\w*|frustrat\w*|struggl\w*|stuck|slow\w*|lost|missing|blocked|tedious|manual\w*|unusable)\b/i;
 return blocks.some(raw=>{
  if(/^\s*(?:&gt;|>)/i.test(raw))return false;
  const text=raw.replace(/<[^>]*>/g,' ').replace(/&#x27;|&#39;|&apos;/gi,"'").replace(/&amp;/gi,'&');
  return subject.test(text)&&pain.test(text);
 });
}
export function classifySourceProvenance(observation){
 if(!observation||typeof observation.title!=='string')throw Error('Source title required for provenance');
 const title=observation.title.trim();
 if(SECONDARY_TITLE.test(title))return {
  kind:'secondary_digest',directReport:false,
  reason:'Aggregate digest or news roundup references other reports; inspect the original linked issue before counting firsthand evidence.'
 };
 const sourceThread=observation.thread_root_id||observation.threadRootId;
 if(observation.source==='hackernews'&&sourceThread&&sourceThread!==observation.id&&!hasExplicitFirsthandDifficulty(observation.body))return {
  kind:'indirect_comment',directReport:false,
  reason:'The comment does not explicitly report a firsthand concrete difficulty outside quoted material; treat as contextual lead only.'
 };
 return {kind:'unassessed_primary_or_other',directReport:null,reason:null};
}
export function provenanceRejection(observation){
 const status=classifySourceProvenance(observation);
 return ['secondary_digest','indirect_comment'].includes(status.kind)?{
  accept:false,category:'unsupported',method:'deterministic-source-provenance',
  sourceRole:status.kind,reason:status.reason
 }:null;
}
