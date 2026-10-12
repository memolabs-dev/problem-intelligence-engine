import { createPool } from '../storage/postgres.mjs';
import { extractProblem } from './extract.mjs';
export async function extractStoredProblems(pool,{limit=100}={}) {
 const rows=(await pool.query('SELECT id,title,body,url FROM observations ORDER BY ingested_at DESC LIMIT $1',[limit])).rows;
 let extracted=0;
 for(const row of rows) {
   const candidate=extractProblem(row);
   if(!candidate) continue;
   const client=await pool.connect();
   try {
     await client.query('BEGIN');
     const existing=await client.query('SELECT problem_id FROM problem_evidence WHERE observation_id=$1 LIMIT 1',[row.id]);
     if(existing.rowCount) { await client.query('COMMIT'); continue; }
     const created=await client.query('INSERT INTO problems(statement) VALUES($1) RETURNING id',[candidate.statement]);
     await client.query('INSERT INTO problem_evidence(problem_id,observation_id,excerpt) VALUES($1,$2,$3)',[created.rows[0].id,candidate.observationId,candidate.excerpt]);
     await client.query('COMMIT'); extracted++;
   } catch(error) { await client.query('ROLLBACK'); throw error; }
   finally {client.release();}
 }
 return {observations:rows.length,created:extracted,method:'heuristic-v1'};
}
if(process.argv[1]?.endsWith('/packages/agents/run.mjs')) {
 const pool=createPool();
 try {console.log(JSON.stringify(await extractStoredProblems(pool)));} finally {await pool.end();}
}
