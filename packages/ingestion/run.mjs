import { createPool } from '../storage/postgres.mjs';
import { ingestSources } from './pipeline.mjs';
const repositories=(process.env.PIE_GITHUB_REPOS || 'nodejs/node').split(',').map(s=>s.trim()).filter(Boolean);
const limit=Number(process.env.PIE_HN_LIMIT || 10);
if (!Number.isInteger(limit) || limit < 0 || limit > 50) throw new Error('PIE_HN_LIMIT must be 0..50');
const idsResponse=await fetch('https://hacker-news.firebaseio.com/v0/askstories.json');
if(!idsResponse.ok) throw new Error('HN list HTTP '+idsResponse.status);
const ids=(await idsResponse.json()).slice(0,limit);
const pool=createPool();
try {
 const result=await ingestSources(pool,{github:repositories,hackerNewsIds:ids,githubToken:process.env.GITHUB_TOKEN});
 console.log(JSON.stringify({repositories,hackerNewsRequested:ids.length,...result}));
} finally { await pool.end(); }
