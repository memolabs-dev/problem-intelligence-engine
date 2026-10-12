// Conservative, deterministic baseline. Never treats quoted instructions as commands.
const patterns = [
  /what is the problem this feature will solve\?/i,
  /(?:fails?|broken|does not work|doesn't work|ignores?|unable to|cannot|can't|need to|need a|wish there was|too slow|performance|error|bug|support for|feature request|looking for|want a)/i
];
export function extractProblem(observation) {
  if (!observation?.id || !observation?.url) return null;
  const title=String(observation.title||'').replace(/\s+/g,' ').trim();
  const body=String(observation.body||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  const combined=`${title} ${body}`;
  if (!patterns.some(pattern=>pattern.test(combined))) return null;
  const excerpt=title || body.slice(0,240);
  if (excerpt.length < 12) return null;
  return { statement: excerpt.slice(0,300), observationId:observation.id, excerpt:excerpt.slice(0,300), sourceUrl:observation.url, method:'heuristic-v1', confidence:'unverified' };
}
