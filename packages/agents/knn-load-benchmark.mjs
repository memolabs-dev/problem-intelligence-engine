import {performance} from 'node:perf_hooks';
import {createPool} from '../storage/postgres.mjs';
import {compareKnnRecall} from './knn-audit.mjs';

const VECTOR_DIMENSIONS=384;
export function validateLoadBenchOptions({vectors=10000,neighbors=10,samples=6,efSearch=100}={}){
 if(!Number.isInteger(vectors)||vectors<100||vectors>20000||
  !Number.isInteger(neighbors)||neighbors<1||neighbors>30||
  !Number.isInteger(samples)||samples<1||samples>12||
  !Number.isInteger(efSearch)||efSearch<10||efSearch>300)throw Error('Invalid HNSW load benchmark bounds');
 return {vectors,neighbors,samples,efSearch};
}
export function summarizeHnswLoad(samples,plan){
 if(!Array.isArray(samples)||!samples.length||samples.some(x=>!Number.isFinite(x.recallAtK)||!Number.isFinite(x.exactMs)||!Number.isFinite(x.annMs)))throw Error('Invalid HNSW measurement');
 const percentile=(vals,p)=>vals.slice().sort((a,b)=>a-b)[Math.min(vals.length-1,Math.ceil(p*vals.length)-1)];
 const ann=samples.map(x=>x.annMs),exact=samples.map(x=>x.exactMs);
 return {samples:samples.length,recallMin:Math.min(...samples.map(x=>x.recallAtK)),
  recallMean:Number((samples.reduce((s,x)=>s+x.recallAtK,0)/samples.length).toFixed(4)),
  annP50Ms:Number(percentile(ann,.5).toFixed(2)),annP95Ms:Number(percentile(ann,.95).toFixed(2)),
  exactP50Ms:Number(percentile(exact,.5).toFixed(2)),exactP95Ms:Number(percentile(exact,.95).toFixed(2)),
  hnswIndexUsed:/Index Scan using pie_hnsw_load_vector_idx/.test(plan),
  planExcerpt:String(plan||'').replace(/\[[^\]]+\]/g,'[vector omitted]').slice(0,1200),
  productionQueryChanged:false};
}
export async function benchmarkHnsw(pool,opts={}){
 const {vectors,neighbors,samples,efSearch}=validateLoadBenchOptions(opts);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SET LOCAL statement_timeout = 180000');
  await client.query('CREATE TEMP TABLE pie_hnsw_load (id INTEGER PRIMARY KEY, embedding vector(384)) ON COMMIT DROP');
  // Fully synthetic, deterministic vectors; zero write access to production observations.
  await client.query(`INSERT INTO pie_hnsw_load(id,embedding)
  SELECT i,('[' || array_to_string(ARRAY(
   SELECT (sin(i*j*0.000173+j*0.017)+cos(i*0.009+j*j*0.0021))::real
   FROM generate_series(1,${VECTOR_DIMENSIONS}) AS j
  ),',') || ']')::vector(384) FROM generate_series(1,$1::int) AS i`,[vectors]);
  await client.query('CREATE INDEX pie_hnsw_load_vector_idx ON pie_hnsw_load USING hnsw(embedding vector_cosine_ops) WITH(m=12,ef_construction=64)');
  await client.query('ANALYZE pie_hnsw_load');
  await client.query('SET LOCAL hnsw.ef_search = '+efSearch);
  const ids=Array.from({length:samples},(_,i)=>1+Math.floor(i*(vectors-1)/Math.max(1,samples-1)));
  const measurements=[];
  let plan='';
  for(const id of ids){
   const v=(await client.query('SELECT embedding::text AS vector FROM pie_hnsw_load WHERE id=$1',[id])).rows[0].vector;
   // Turning off the ANN index only for the exact reference makes the expected
   // neighbor set deterministic. This is a benchmark-local transaction setting.
   await client.query('SET LOCAL enable_indexscan=off');
   await client.query('SET LOCAL enable_bitmapscan=off');
   const exactStart=performance.now();
   const exact=(await client.query('SELECT id,embedding <=> $1::vector AS distance FROM pie_hnsw_load WHERE id<>$2 ORDER BY embedding <=> $1::vector LIMIT $3',[v,id,neighbors])).rows;
   const exactMs=performance.now()-exactStart;
   await client.query('SET LOCAL enable_indexscan=on');
   await client.query('SET LOCAL enable_bitmapscan=on');
   if(!plan){const exp=await client.query('EXPLAIN SELECT id FROM pie_hnsw_load ORDER BY embedding <=> $1::vector LIMIT $2',[v,neighbors]);plan=exp.rows.map(x=>x['QUERY PLAN']).join('\n');}
   const annStart=performance.now();
   const annAll=(await client.query('SELECT id,embedding <=> $1::vector AS distance FROM pie_hnsw_load ORDER BY embedding <=> $1::vector LIMIT $2',[v,neighbors+1])).rows;
   const ann=annAll.filter(row=>row.id!==id).slice(0,neighbors);
   const annMs=performance.now()-annStart;
   const key=id=>String(id);
   const stats=compareKnnRecall(exact.map(x=>({left_id:key(id),right_id:key(x.id)})),ann.map(x=>({left_id:key(id),right_id:key(x.id)})),{topK:neighbors});
   measurements.push({anchorId:id,recallAtK:stats.recallAtK,exactMs,annMs,missed:stats.missed.length});
  }
  const summary=summarizeHnswLoad(measurements,plan);
  return {kind:'synthetic_hnsw_load_benchmark',vectors,dimensions:VECTOR_DIMENSIONS,neighbors,efSearch,
   ...summary,measurements,independentRealSourceAccuracy:false,productionVectorsUnchanged:true,
   caveat:'Synthetic vectors and temporary HNSW index only. Verify recall and query plans on a separate representative real-source dataset before changing production retrieval.'};
 }finally{
  try{await client.query('ROLLBACK');}finally{client.release();}
 }
}
if(process.argv[1]?.endsWith('/packages/agents/knn-load-benchmark.mjs')){
 const pool=createPool();try{
  console.log(JSON.stringify(await benchmarkHnsw(pool,{
   vectors:Number(process.env.PIE_KNN_BENCH_VECTORS||10000),
   neighbors:Number(process.env.PIE_KNN_BENCH_NEIGHBORS||10),
   samples:Number(process.env.PIE_KNN_BENCH_SAMPLES||6),
   efSearch:Number(process.env.PIE_KNN_BENCH_EF_SEARCH||100)
  }),null,2));
 }finally{await pool.end();}
}
