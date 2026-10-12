import test from 'node:test';import assert from 'node:assert/strict';
import {assess} from '../packages/scoring/score.mjs';
test('unknown is not zero',()=>assert.deepEqual(assess({}),{score:null,coverage:0,missing:['pain','payment','buyerAccess','competitionGap','feasibility','advantage'],rubric:'v1'}));
test('fully evidenced opportunity',()=>assert.deepEqual(assess({pain:1,payment:1,buyerAccess:1,competitionGap:1,feasibility:1,advantage:1}).score,100));
test('reject invalid factors',()=>assert.throws(()=>assess({pain:2}),RangeError));
test('partial evidence has coverage',()=>assert.deepEqual(assess({payment:0.8}).coverage,25));
