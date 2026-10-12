import { normalizeObservation } from './normalize.mjs';
export function normalizeHackerNews(item) {
  if (!item || item.deleted || item.dead || !['story','ask','show'].includes(item.type)) return null;
  return normalizeObservation({ source:'hackernews', externalId:item.id, url:`https://news.ycombinator.com/item?id=${item.id}`, title:item.title ?? '', body:item.text ?? '', publishedAt:item.time ? new Date(item.time*1000).toISOString() : null });
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
