import {createPool} from '../storage/postgres.mjs';
import {embedText,validateEmbedding,EMBEDDING_MODEL} from './embed.mjs';

/**
 * Targeted nearest-neighbor retrieval over source-current, verified candidate
 * statements. Similarity is NOT a corroboration verdict.
 *
 * Keep ORDER BY on the raw pgvector expression so PostgreSQL may use HNSW
 * rather than materializing all O(N²) pairwise distances.
 */
export const SEARCH_STORED_PROBLEMS_SQL=`
SELECT md.observation_id AS id,md.statement,md.excerpt,
       o.source,o.url,o.reporter_key,
       1-(e.embedding <=> $2::vector) AS similarity
FROM problem_embeddings e
JOIN model_decisions md ON md.run_id=e.run_id AND md.observation_id=e.observation_id
JOIN observations o ON o.id=md.observation_id
WHERE e.embedding_model=$1 AND md.status='found'
  AND md.source_content_hash=o.content_hash
  AND md.run_id=(
    SELECT history.run_id
    FROM model_decisions history JOIN model_runs run ON run.id=history.run_id
    WHERE history.observation_id=md.observation_id
    ORDER BY run.started_at DESC,run.id DESC LIMIT 1
  )
ORDER BY e.embedding <=> $2::vector
LIMIT $3`;

export function normalizeNearestResults(rows,{minSimilarity=0.4,limit=10}={}){
 if(!Array.isArray(rows))throw new TypeError('Expected database matches');
 if(!Number.isFinite(minSimilarity)||minSimilarity<0||minSimilarity>1||!Number.isInteger(limit)||limit<1||limit>100)throw RangeError('Invalid search controls');
 const seen=new Set(),out=[];
 for(const row of rows){
  const s=Number(row.similarity);
  if(!Number.isFinite(s)||s<minSimilarity||seen.has(row.id))continue;
  if(typeof row?.statement!=='string'||typeof row?.excerpt!=='string'||!row.url?.startsWith('https://'))continue;
  seen.add(row.id);
  out.push({
   observationId:row.id,problem:row.statement,excerpt:row.excerpt,sourceUrl:row.url,source:row.source,
   similarity:Math.round(s*10000)/10000,verification:'source-grounded_model_screened',
   sameUnderlyingProblem:'not_reviewed',commercialValidation:'unknown'
  });
  if(out.length>=limit)break;
 }
 return out;
}

export async function searchStoredProblems(pool,query,{limit=10,minSimilarity=0.4,model=EMBEDDING_MODEL,embed=embedText}={}){
 if(typeof query!=='string'||query.trim().length<12||query.length>1000)throw Error('Query must describe a concrete problem in 12..1000 characters');
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isFinite(minSimilarity)||minSimilarity<0||minSimilarity>1)throw RangeError('Invalid nearest-neighbor search controls');
 const embedding=validateEmbedding(await embed(query.trim()));
 const vector='['+embedding.join(',')+']';
 // More than requested may be fetched because relevance filtering is applied after KNN.
 const {rows}=await pool.query(SEARCH_STORED_PROBLEMS_SQL,[model,vector,Math.min(100,Math.max(limit*4,20))]);
 const results=normalizeNearestResults(rows,{limit,minSimilarity});
 return {query:query.trim(),indexModel:model,considered:rows.length,matched:results.length,results};
}
if(process.argv[1]?.endsWith('/packages/agents/search-problems.mjs')){
 const query=process.argv.slice(2).join(' ').trim();
 if(!query)throw Error('Usage: npm run problems:search -- "describe a concrete problem"');
 const pool=createPool();
 try{console.log(JSON.stringify(await searchStoredProblems(pool,query),null,2));}
 finally{await pool.end();}
}
