import {createPool} from '../storage/postgres.mjs';
import {clusterProblems} from './cluster.mjs';
const pool=createPool();
try {
 const {rows}=await pool.query('SELECT p.id,p.statement,o.url,o.source FROM problems p JOIN problem_evidence e ON e.problem_id=p.id JOIN observations o ON o.id=e.observation_id ORDER BY p.id');
 const clusters=clusterProblems(rows);
 console.log(JSON.stringify({candidates:rows.length,clusters:clusters.length,results:clusters.map(c=>({problem:c.representative,evidence:c.members.map(m=>({source:m.source,url:m.url})),evidenceCount:c.members.length,commercialValidation:'unknown'}))},null,2));
} finally {await pool.end();}
