// Conservative evidence-first heuristic. A title alone cannot establish a problem.
const signal = /\b(?:fails?|failed|broken|does not work|doesn't work|ignores?|unable to|cannot|can't|too slow|slowdown|performance regression|crash(?:es|ed|ing)?|segfault|regression|fatal|memory leak|error|bug|doesn't support|not supported|need to|need a|wish there was|feature request|support for|missing|refuses? to|workaround)\b/i;
const reject = /^(?:\[?spam\]?|ask hn: (?:what(?:'s| is)|how do)|what to build)/i;
const operationalPain = /\b(?:manually|manual|copy(?:ing|ies)?|re-?enter(?:ing)?|spreadsheet|workaround|every (?:day|morning|week)|hours? (?:each|per) (?:day|week))\b/i;
const friction = /\b(?:because|no integration|between systems|repetitive|takes? (?:hours|days)|cannot automate|without automation)\b/i;
export function extractProblem(observation) {
 if (!observation?.id || !observation?.url) return null;
 const title=String(observation.title||'').replace(/\s+/g,' ').trim();
 const rawBody=String(observation.body||'');
 const rawTitle=String(observation.title||'');
 const body=rawBody.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
 const implicit=operationalPain.test(`${title} ${body}`)&&friction.test(`${title} ${body}`);
 if (reject.test(title) || (!signal.test(`${title} ${body}`)&&!implicit)) return null;
 // Never claim a source-backed problem if no substantive source excerpt exists.
 const excerpt=(signal.test(title)||implicit&&operationalPain.test(title)) && title.length>=12 ? rawTitle.trim().slice(0,300) : rawBody.split(/(?<=[.!?])\s+|\n+/u).map(x=>x.trim()).find(x=>x.length>=12&&x.length<=300&&(signal.test(x)||implicit&&(operationalPain.test(x)||friction.test(x))));
 if (!excerpt || excerpt.length<12 || !title || !`${rawTitle}\n${rawBody}`.includes(excerpt)) return null;
 return {statement:title.slice(0,300),observationId:observation.id,excerpt:excerpt.slice(0,300),sourceUrl:observation.url,method:'heuristic-v2',confidence:'unverified'};
}
