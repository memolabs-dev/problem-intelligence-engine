import test from 'node:test';
import assert from 'node:assert/strict';
import {extractProblem} from '../packages/agents/extract.mjs';
test('extracts source-linked candidate with unverified confidence',()=>{const x=extractProblem({id:'github:1',url:'https://github.com/org/repo/issues/1',title:'Feature request: support for partial CSV',body:'Need to process files'});assert.equal(x.observationId,'github:1');assert.equal(x.confidence,'unverified');assert.match(x.statement,/CSV/);});
test('does not fabricate problem from unrelated observation',()=>assert.equal(extractProblem({id:'hn:1',url:'https://example.org',title:'A sunny day',body:'Nothing to report'}),null));

test('rejects generic discussion even if its body mentions a need',()=>assert.equal(extractProblem({id:'hn:2',url:'https://news.ycombinator.com/item?id=2',title:'Ask HN: What is your favorite tool?',body:'I need to choose a tool'}),null));
test('uses a literal source excerpt rather than synthesizing evidence',()=>{const x=extractProblem({id:'github:2',url:'https://github.com/a/b/issues/2',title:'CSV parser request',body:'The parser fails on large input files.'});assert.ok(x);assert.equal(x.excerpt,'The parser fails on large input files.');});
test('rejects spam and unsupported generic discussion',()=>{assert.equal(extractProblem({id:'github:3',url:'https://github.com/a/b/issues/3',title:'[SPAM]',body:'This error is not relevant'}),null);});
