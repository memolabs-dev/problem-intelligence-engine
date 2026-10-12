import { normalizeObservation } from './normalize.mjs';
export function normalizeGithubIssue(issue) {
  if (!issue || issue.pull_request || !issue.html_url || !issue.id) return null;
  return normalizeObservation({ source:'github', externalId:issue.id, url:issue.html_url, title:issue.title ?? '', body:issue.body ?? '', publishedAt:issue.created_at ?? null });
}
export async function fetchGithubIssues(owner, repo, { fetcher=fetch, token, perPage=30 }={}) {
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new Error('Invalid repository');
  const headers={Accept:'application/vnd.github+json','User-Agent':'problem-intelligence-engine'};
  if (token) headers.Authorization=`Bearer ${token}`;
  const response=await fetcher(`https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=${Math.min(100,Math.max(1,perPage))}`,{headers});
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  const issues=await response.json();
  if (!Array.isArray(issues)) throw new Error('Invalid GitHub response');
  return issues.map(normalizeGithubIssue).filter(Boolean);
}
