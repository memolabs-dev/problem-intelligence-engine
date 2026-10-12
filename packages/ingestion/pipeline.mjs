import { fetchGithubIssues } from '../connectors/github.mjs';
import { fetchHackerNews } from '../connectors/hackernews.mjs';
import { persistObservations } from '../storage/client.mjs';

export async function ingestSources(client, { github = [], hackerNewsIds = [], fetcher = fetch, githubToken } = {}) {
  const observations = [];
  for (const repository of github) {
    const match = /^([\w.-]+)\/([\w.-]+)$/.exec(repository);
    if (!match) throw new Error(`Invalid GitHub repository: ${repository}`);
    observations.push(...await fetchGithubIssues(match[1], match[2], { fetcher, token: githubToken }));
  }
  if (hackerNewsIds.length) observations.push(...await fetchHackerNews(hackerNewsIds, { fetcher }));
  const unique = [...new Map(observations.map(observation => [observation.id, observation])).values()];
  const connection = typeof client.connect === 'function' ? await client.connect() : client;
  try { await persistObservations(connection, unique); }
  finally { if (connection !== client) connection.release(); }
  return { fetched: observations.length, unique: unique.length };
}
