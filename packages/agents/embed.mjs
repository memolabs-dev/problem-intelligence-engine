import {createHash} from 'node:crypto';
import {createPool} from '../storage/postgres.mjs';

export const EMBEDDING_MODEL='all-minilm';
export const EMBEDDING_DIMENSIONS=384;

export function validateEmbedding(value,dimensions=EMBEDDING_DIMENSIONS){
 if(!Array.isArray(value)||value.length!==dimensions||!value.every(v=>typeof v==='number'&&Number.isFinite(v)))throw Error('Invalid embedding dimensions or values');
 const norm=Math.hypot(...value);
 if(norm<1e-12)throw Error('Zero-norm embedding');
 return value;
}
export async function embedText(text,{fetcher=fetch,endpoint='http://127.0.0.1:11434/api/embed',model=EMBEDDING_MODEL,timeoutMs=45000}={}){
 if(typeof text!=='string'||!text.trim())throw Error('Embedding text required');
 if(!endpoint.startsWith('http://127.0.0.1:11434/'))throw Error('Embedding endpoint must be local Ollama');
 const response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(timeoutMs),body:JSON.stringify({model,input:text})});
 if(!response.ok)throw Error('Ollama embedding HTTP '+response.status);
 const data=await response.json();
 return validateEmbedding(data?.embeddings?.[0]);
}
export const CURRENT_CANDIDATES_SQL=`
WITH ranked AS (
 SELECT md.run_id,md.observation_id,md.status,md.statement,md.excerpt,md.source_content_hash,
        r.started_at,
        row_number() OVER (PARTITION BY md.observation_id ORDER BY r.started_at DESC,r.id DESC) AS rn
 FROM model_decisions md JOIN model_runs r ON r.id=md.run_id
)
SELECT ranked.run_id, ranked.observation_id, ranked.statement, ranked.excerpt,
       o.source,o.url,o.reporter_key,o.content_hash
FROM ranked JOIN observations o ON o.id=ranked.observation_id
WHERE ranked.rn=1 AND ranked.status='found' AND ranked.source_content_hash=o.content_hash
ORDER BY o.id LIMIT $1`;
export async function storeEmbeddings(pool,{limit=300,model=EMBEDDING_MODEL,embed=embedText}={}){
 if(!Number.isInteger(limit)||limit<1||limit>5000)throw RangeError('Invalid embedding batch limit');
 const {rows}=await pool.query(CURRENT_CANDIDATES_SQL,[limit]);
 let inserted=0,unchanged=0,errors=0;
 const findings=[];
 for(const row of rows){
  const statementHash=createHash('sha256').update(row.statement).digest('hex');
  const existing=await pool.query('SELECT statement_hash FROM problem_embeddings WHERE run_id=$1 AND observation_id=$2 AND embedding_model=$3',[row.run_id,row.observation_id,model]);
  if(existing.rows[0]?.statement_hash?.trim()===statementHash){unchanged++;continue;}
  try{
   const vector=validateEmbedding(await embed(row.statement));
   // pgvector's textual input format is parameterized and validated before insertion.
   await pool.query(`INSERT INTO problem_embeddings(run_id,observation_id,embedding_model,statement_hash,embedding)
    VALUES($1,$2,$3,$4,$5::vector)
    ON CONFLICT(run_id,observation_id,embedding_model) DO UPDATE SET
    statement_hash=EXCLUDED.statement_hash,embedding=EXCLUDED.embedding,created_at=NOW()`,
   [row.run_id,row.observation_id,model,statementHash,'['+vector.join(',')+']']);
   inserted++;
  }catch(error){errors++;findings.push({observationId:row.observation_id,error:String(error?.message||error).slice(0,150)});}
 }
 return {candidates:rows.length,inserted,unchanged,errors,model,findings};
}
if(process.argv[1]?.endsWith('/packages/agents/embed.mjs')){
 const pool=createPool();
 try{
  const result=await storeEmbeddings(pool,{limit:Number(process.env.PIE_EMBED_LIMIT||300)});
  console.log(JSON.stringify(result));
  if(result.errors)process.exitCode=1;
 }finally{await pool.end();}
}
