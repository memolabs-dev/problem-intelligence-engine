import test from 'node:test';
import assert from 'node:assert/strict';
import {clusterProblems,similarity} from '../packages/agents/cluster.mjs';
test('groups near duplicate issues',()=>{const c=clusterProblems([{statement:'CSV streaming parsing crashes on large files'},{statement:'CSV streaming parsing crashes on huge files'},{statement:'Router hardware purchase'}]);assert.equal(c.length,2);assert.equal(c[0].members.length,2)});
test('does not group unrelated issues',()=>assert.equal(similarity('router firmware setup','csv processing performance'),0));
test('rejects invalid threshold',()=>assert.throws(()=>clusterProblems([],{threshold:2}),RangeError));
