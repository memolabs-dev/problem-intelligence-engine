import {randomUUID} from 'node:crypto';

/** Search results are discovery leads, not independently verified user reports. */
export async function saveTargetedSearchAudit(pool,report,observations){
 if(!Array.isArray(observations)||!report?.query||!Array.isArray(report.sources))throw Error('Invalid targeted search audit');
 const runId=randomUUID();
 const bySource=new Map(report.sources.map(item=>[item.source,item]));
 const github=bySource.get('github')?.status||'not_run';
 const hn=bySource.get('hackernews')?.status||'not_run';
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`INSERT INTO targeted_search_runs
   (id,query,github_status,hackernews_status,matched_raw,unique_observations)
   VALUES ($1,$2,$3,$4,$5,$6)`,
   [runId,report.query,github,hn,report.matchedRaw,report.uniqueObservations]);
  for(const o of observations){
   if(!o?.id||!o?.contentHash)throw Error('Incomplete search hit');
   await client.query(`INSERT INTO targeted_search_hits
    (run_id,observation_id,source_content_hash) VALUES($1,$2,$3)`,
    [runId,o.id,o.contentHash]);
  }
  await client.query('COMMIT');
  return runId;
 }catch(error){await client.query('ROLLBACK');throw error;}
 finally{client.release();}
}
