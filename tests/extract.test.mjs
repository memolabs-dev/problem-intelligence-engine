import test from 'node:test';
import assert from 'node:assert/strict';
import {extractProblem} from '../packages/agents/extract.mjs';
test('extracts source-linked candidate with unverified confidence',()=>{const x=extractProblem({id:'github:1',url:'https://github.com/org/repo/issues/1',title:'Feature request: support for partial CSV',body:'Need to process files'});assert.equal(x.observationId,'github:1');assert.equal(x.confidence,'unverified');assert.match(x.statement,/CSV/);});
test('does not fabricate problem from unrelated observation',()=>assert.equal(extractProblem({id:'hn:1',url:'https://example.org',title:'A sunny day',body:'Nothing to report'}),null));
