import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvidenceGraph} from '../packages/agents/evidence-graph.mjs';
const source=(id,title)=>({id,title,body:title,url:'https://example.org/'+id,source:id.split(':')[0]});
const found=(o,statement)=>({observationId:o.id,status:'found',candidate:{statement,excerpt:o.title,sourceUrl:o.url},verification:{accept:true,category:'observed_failure'}});
test('single observation is not recurring market demand',()=>{
 const o=source('github:1','CSV uploads fail on large files');
 const r=buildEvidenceGraph({results:[found(o,'CSV uploads fail on very large files')]},[o]);
 assert.equal(r.validCandidates,1);
 assert.equal(r.problems[0].corroboration,'single_observation');
 assert.equal(r.problems[0].commercialValidation,'unknown');
});
test('multiple observations do not prove independent reporters',()=>{
 const a=source('github:1','CSV streaming fails on large files');
 const b=source('hackernews:2','CSV streaming fails on huge files');
 const r=buildEvidenceGraph({results:[found(a,'CSV streaming fails on large files'),found(b,'CSV streaming fails on huge files')]},[a,b]);
 assert.equal(r.clusterCount,1);
 assert.equal(r.problems[0].observationCount,2);
 assert.equal(r.problems[0].distinctReporterAccountCount,null);
 assert.equal(r.problems[0].platformCount,2);
});
test('separates observations from distinct identified reporters',()=>{
 const a={...source('github:1','CSV streaming fails on large files'),reporterKey:'person-one'};
 const b={...source('github:2','CSV streaming fails on huge files'),reporterKey:'person-two'};
 const r=buildEvidenceGraph({results:[found(a,'CSV streaming fails on large files'),found(b,'CSV streaming fails on huge files')]},[a,b]);
 assert.equal(r.clusterCount,1);
 assert.equal(r.problems[0].distinctReporterAccountCount,2);
 assert.equal(r.problems[0].corroboration,'multiple_distinct_accounts_independence_unverified');
});
test('rejects a quote that does not appear in the source',()=>{
 const o=source('github:1','CSV uploads fail on large files');
 const item=found(o,'Large CSV uploads fail on very large files');
 item.candidate.excerpt='This sentence never appeared';
 const r=buildEvidenceGraph({results:[item]},[o]);
 assert.equal(r.validCandidates,0);
 assert.equal(r.invalidCandidates[0].reason,'quote_not_in_source');
});
test('does not count the same observation twice',()=>{
 const o=source('github:1','CSV uploads fail on large files');
 const item=found(o,'Large CSV uploads fail on very large files');
 assert.throws(()=>buildEvidenceGraph({results:[item,item]},[o]),/duplicate/);
});
