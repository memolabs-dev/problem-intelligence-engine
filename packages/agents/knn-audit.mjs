import {createPool} from '../storage/postgres.mjs';
import {EMBEDDING_MODEL} from './embed.mjs';

// Experimental read-only ANN candidate retrieval. Keep separate from the
// canonical exact corroboration query until real-source recall is validated.
export const ANN_CANDIDATES_SQL=`
WITH ranked AS (
 SELECT md.run_id,md.observation_id,md.status,md.source_content_hash,
   row_number() OVER(PARTITION BY md.observation_id ORDER BY r.started_at DESC,r.id DESC) AS rn
 FROM model_decisions md JOIN model_runs r ON r.id=md.run_id
), current AS MATERIALIZED (
 SELECT m.run_id,m.observation_id,o.thread_root_id,e.embedding
 FROM ranked m JOIN observations o ON o.id=m.observation_id
 JOIN problem_embeddings e ON e.run_id=m.run_id AND e.observation_id=m.observation_id
 WHERE m.rn=1 AND m.status='found' AND m.source_content_hash=o.content_hash
   AND e.embedding_model=$1
), anchor AS (
 SELECT * FROM current ORDER BY observation_id LIMIT $2
), proposed AS (
 SELECT a.observation_id AS aid,b.observation_id AS bid,
  1-(a.embedding <=> b.embedding) AS similarity
 FROM anchor a CROSS JOIN LATERAL (
  SELECT near.run_id,near.observation_id,near.embedding
  FROM problem_embeddings near
  WHERE near.embedding_model=$1
  ORDER BY near.embedding <=> a.embedding LIMIT $3
 ) neighbor JOIN current b ON b.run_id=neighbor.run_id AND b.observation_id=neighbor.observation_id
 WHERE a.observation_id<>b.observation_id
   AND COALESCE(a.thread_root_id,a.observation_id)<>COALESCE(b.thread_root_id,b.observation_id)
), canonical AS (
 SELECT LEAST(aid,bid) AS left_id,GREATEST(aid,bid) AS right_id,
  MAX(similarity) AS similarity
 FROM proposed GROUP BY LEAST(aid,bid),GREATEST(aid,bid)
)
SELECT left_id,right_id,similarity FROM canonical
WHERE similarity >= $4 ORDER BY similarity DESC,left_id,right_id LIMIT $5`;
export const EXACT_CANDIDATES_SQL=`
WITH ranked AS (
 SELECT md.run_id,md.observation_id,md.status,md.source_content_hash,
 row_number() OVER(PARTITION BY md.observation_id ORDER BY r.started_at DESC,r.id DESC) AS rn
 FROM model_decisions md JOIN model_runs r ON r.id=md.run_id
), current AS (
 SELECT m.observation_id,o.thread_root_id,e.embedding
 FROM ranked m JOIN observations o ON o.id=m.observation_id
 JOIN problem_embeddings e ON e.run_id=m.run_id AND e.observation_id=m.observation_id
 WHERE m.rn=1 AND m.status='found' AND m.source_content_hash=o.content_hash AND e.embedding_model=$1
), anchor AS (SELECT observation_id FROM current ORDER BY observation_id LIMIT $2)
SELECT a.observation_id AS left_id,b.observation_id AS right_id,
 1-(a.embedding <=> b.embedding) AS similarity
FROM current a JOIN current b ON a.observation_id<b.observation_id
WHERE (a.observation_id IN (SELECT observation_id FROM anchor) OR b.observation_id IN (SELECT observation_id FROM anchor))
 AND COALESCE(a.thread_root_id,a.observation_id)<>COALESCE(b.thread_root_id,b.observation_id)
 AND 1-(a.embedding <=> b.embedding)>=$3
ORDER BY similarity DESC,a.observation_id,b.observation_id LIMIT $4`;
const key=r=>[r.left_id,r.right_id].sort().join('|');
export function compareKnnRecall(exact,approx,{topK=20}={}){
 if(!Array.isArray(exact)||!Array.isArray(approx)||!Number.isInteger(topK)||topK<1||topK>1000)throw Error('Invalid KNN audit input');
 const exactKeys=[...new Set(exact.slice(0,topK).map(key))];
 const approxSet=new Set(approx.map(key));
 const recovered=exactKeys.filter(k=>approxSet.has(k));
 return {exactTop:exactKeys.length,annCandidates:approxSet.size,recovered:recovered.length,
  recallAtK:exactKeys.length?recovered.length/exactKeys.length:null,
  missed:exactKeys.filter(k=>!approxSet.has(k)),approximateOnly:true,
  productionQueryChanged:false};
}
export async function auditKnn(pool,{anchorLimit=40,neighbors=20,threshold=0.35,topK=20,model=EMBEDDING_MODEL}={}){
 if(!Number.isInteger(anchorLimit)||anchorLimit<1||anchorLimit>200||
  !Number.isInteger(neighbors)||neighbors<1||neighbors>100||
  !Number.isInteger(topK)||topK<1||topK>100||
  typeof threshold!=='number'||!Number.isFinite(threshold)||threshold<0||threshold>1)throw Error('Invalid KNN audit bounds');
 const exact=await pool.query(EXACT_CANDIDATES_SQL,[model,anchorLimit,threshold,topK]);
 const ann=await pool.query(ANN_CANDIDATES_SQL,[model,anchorLimit,neighbors,threshold,Math.min(1000,anchorLimit*neighbors)]);
 return {kind:'experimental_knn_diagnostic',model,anchorLimit,neighbors,threshold,topK,
  ...compareKnnRecall(exact.rows,ann.rows,{topK}),
  caveat:'Read-only candidate recall check on the current limited development corpus; not a population recall guarantee or evidence of semantic equivalence.'};
}
if(process.argv[1]?.endsWith('/packages/agents/knn-audit.mjs')){
 const pool=createPool();try{
  const report=await auditKnn(pool,{anchorLimit:Number(process.env.PIE_KNN_AUDIT_ANCHORS||40),neighbors:Number(process.env.PIE_KNN_AUDIT_NEIGHBORS||20),threshold:Number(process.env.PIE_KNN_AUDIT_THRESHOLD||0.35),topK:Number(process.env.PIE_KNN_AUDIT_TOPK||20)});
  console.log(JSON.stringify(report,null,2));
 }finally{await pool.end();}
}
