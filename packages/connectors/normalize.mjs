import { createHash } from 'node:crypto';
export function normalizeObservation({ source, externalId, url, title = '', body = '', publishedAt = null }) {
  if (!['github', 'hackernews'].includes(source)) throw new Error('Unsupported source');
  if (!externalId || !url?.startsWith('https://')) throw new Error('Missing identity or HTTPS URL');
  const contentHash = createHash('sha256').update(`${title}\n${body}`).digest('hex');
  return { id: `${source}:${externalId}`, source, externalId: String(externalId), url, title, body, publishedAt, contentHash };
}
