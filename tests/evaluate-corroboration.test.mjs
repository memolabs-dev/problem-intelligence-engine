import test from 'node:test';
import assert from 'node:assert/strict';
import {measurePairQuality,evaluatePairs} from '../packages/agents/evaluate-corroboration.mjs';
test('semantic pair metrics distinguish false merges, misses and model failures',()=>{
 const labels=[{id:'p1',expected:'same_problem'},{id:'p2',expected:'same_problem'},{id:'n1',expected:'different_problem'},{id:'n2',expected:'different_problem'}];
 const results=[{id:'p1',verdict:'same_problem'},{id:'p2',verdict:'different_problem'},{id:'n1',verdict:'same_problem'},{id:'n2',verdict:'error'}];
 const metric=measurePairQuality(labels,results);
 assert.deepEqual([metric.tp,metric.fn,metric.fp,metric.tn,metric.unresolved],[1,1,1,0,1]);
 assert.equal(metric.precision,0.5);assert.equal(metric.recall,0.5);assert.equal(metric.coverage,0.75);
});
test('synthetic pair evaluation does not claim an independent holdout',async()=>{
 const data=[{id:'yes',expected:'same_problem',left:'A',right:'B'}];
 const r=await evaluatePairs(data,{judge:async()=>({verdict:'same_problem',rationale:'Identical underlying issue'})});
 assert.equal(r.independentHoldout,false);
 assert.equal(r.metrics.tp,1);
});
