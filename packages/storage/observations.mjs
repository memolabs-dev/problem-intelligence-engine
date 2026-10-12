export const UPSERT_OBSERVATION = `INSERT INTO observations
(id,source,external_id,url,title,body,published_at,content_hash)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT (id) DO UPDATE SET
url=EXCLUDED.url,title=EXCLUDED.title,body=EXCLUDED.body,
published_at=EXCLUDED.published_at,content_hash=EXCLUDED.content_hash,
updated_at=NOW()
WHERE observations.content_hash IS DISTINCT FROM EXCLUDED.content_hash
OR observations.url IS DISTINCT FROM EXCLUDED.url`;
export function observationParams(o){
 if(!o?.id || !o.source || !o.contentHash) throw new Error('Invalid observation');
 return [o.id,o.source,o.externalId,o.url,o.title,o.body,o.publishedAt,o.contentHash];
}
