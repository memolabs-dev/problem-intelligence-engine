import { normalizeObservation } from './normalize.mjs';
import {accountKey} from './identity.mjs';
export function normalizeHackerNews(item) {
  if (!item || item.deleted || item.dead || !['story','ask','show'].includes(item.type)) return null;
  return normalizeObservation({ source:'hackernews', externalId:item.id, url:`https://news.ycombinator.com/item?id=${item.id}`, title:item.title ?? '', body:item.text ?? '', publishedAt:item.time ? new Date(item.time*1000).toISOString() : null, reporterKey:accountKey('hackernews',item.by) });
}
export async function fetchHackerNews(ids, { fetcher=fetch, limit=20 }={}) {
  const result=[];
  for (const id of ids.slice(0,limit)) {
    const response=await fetcher(`https://hacker-news.firebaseio.com/v0/item/${encodeURIComponent(id)}.json`);
    if (!response.ok) throw new Error(`HN HTTP ${response.status}`);
    const observation=normalizeHackerNews(await response.json());
    if (observation) result.push(observation);
  }
  return result;
}

/** HN Algolia search hits are individual public comments. Preserve their
 * parent STORY identity so multiple replies cannot masquerade as independent
 * public discussions. Body may contain HN HTML; evidence remains verbatim.
 */
export function normalizeHackerNewsSearchComment(hit){
 const id=String(hit?.objectID??'');
 const root=String(hit?.story_id??'');
 if(!/^\d+$/.test(id)||!/^\d+$/.test(root)||typeof hit.comment_text!=='string'||hit.comment_text.trim().length<12)return null;
 return normalizeObservation({
  source:'hackernews',externalId:id,
  url:'https://news.ycombinator.com/item?id='+id,
  title:'',body:hit.comment_text,
  publishedAt:Number.isInteger(hit.created_at_i)?new Date(hit.created_at_i*1000).toISOString():null,
  reporterKey:accountKey('hackernews',hit.author??null),
  threadRootId:'hackernews:'+root
 });
}
