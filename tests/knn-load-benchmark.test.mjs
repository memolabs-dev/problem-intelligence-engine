import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLoadBenchOptions,summarizeHnswLoad,benchmarkHnsw} from '../packages/agents/knn-load-benchmark.mjs';
test('load test has bounded dataset, search, sample and ANN effort',()=>{
 assert.deepEqual(validateLoadBenchOptions(),{vectors:10000,neighbors:10,samples:6,efSearch:100});
 assert.throws(()=>validateLoadBenchOptions({vectors:100000}),/bounds/);
 assert.throws(()=>validateLoadBenchOptions({neighbors:0}),/bounds/);
 assert.throws(()=>validateLoadBenchOptions({samples:30}),/bounds/);
 assert.throws(()=>validateLoadBenchOptions({efSearch:5000}),/bounds/);
});
test('summary reports recall, latency percentiles and sanitized query plan',()=>{
 const r=summarizeHnswLoad([{recallAtK:.8,exactMs:30,annMs:3},{recallAtK:1,exactMs:20,annMs:2}],
  "Index Scan using pie_hnsw_load_vector_idx (embedding <=> '[1,2,3]'::vector)");
 assert.equal(r.recallMin,.8);
 assert.equal(r.recallMean,.9);
 assert.equal(r.annP95Ms,3);
 assert.equal(r.hnswIndexUsed,true);
 assert.ok(!r.planExcerpt.includes('[1,2,3]'));
 assert.equal(r.productionQueryChanged,false);
});
test('small integration benchmark drops temporary data and never writes canonical observations',async t=>{
 if(process.env.PIE_INTEGRATION!=='1')return t.skip('PIE_INTEGRATION=1');
 const {createPool}=await import('../packages/storage/postgres.mjs');
 const pool=createPool();try{
  const report=await benchmarkHnsw(pool,{vectors:120,neighbors:5,samples:2,efSearch:40});
  assert.equal(report.vectors,120);
  assert.equal(report.measurements.length,2);
  assert.ok(report.recallMean>=0&&report.recallMean<=1);
  assert.equal(report.productionVectorsUnchanged,true);
  const table=await pool.query("SELECT count(*)::int AS n FROM pg_class WHERE relname='pie_hnsw_load'");
  assert.equal(table.rows[0].n,0);
 }finally{await pool.end();}
});
