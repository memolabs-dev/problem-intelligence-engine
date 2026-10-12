import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleBlindPairs,createAnnotationTemplate,prepareHoldout,HOLDOUT_PAIR_POOL_SQL} from '../packages/agents/holdout.mjs';
import {evaluateIndependentReviews,parseReviewerAnnotations} from '../packages/agents/holdout-review.mjs';

function pair(a,b,{similarity=0.5,accountA='a',accountB='b',sourceA='github',sourceB='github'}={}){
 return {
  left_id:'github:'+a,right_id:'github:'+b,
  left_title:'A concrete problem '+a,right_title:'A concrete problem '+b,
  left_body:'Original source text A',right_body:'Original source text B',
  left_source:sourceA,right_source:sourceB,
  left_url:'https://github.com/memolabs/sample/issues/'+a,
  right_url:'https://github.com/memolabs/sample/issues/'+b,
  left_account:accountA,right_account:accountB,
  left_hash:'a'.repeat(64),right_hash:'b'.repeat(64),
  similarity
 };
}
test('blind sampling excludes existing development examples and removes model scores and account keys',()=>{
 const sample=sampleBlindPairs([pair(1,2),pair(2,3),pair(3,4)],{target:5,devIds:['github:3']});
 assert.equal(sample.manifest.filtered.developerOverlap,2);
 assert.equal(sample.manifest.selected,1);
 assert.equal(sample.manifest.shortfall,4);
 assert.equal(sample.blind.independentHoldout,false);
 const text=JSON.stringify(sample.blind);
 assert.ok(!text.includes('similarity'));
 assert.ok(!text.includes('accountA'));
 assert.ok(!text.includes('same_problem'));
 assert.equal(sample.blind.pairs[0].left.url,'https://github.com/memolabs/sample/issues/1');
});
test('deterministic sampling is independent of raw input ordering',()=>{
 const rows=Array.from({length:8},(_,i)=>pair(i+1,i+2,{similarity:i/10,sourceB:i%2?'hackernews':'github'}));
 const first=sampleBlindPairs(rows,{target:5,seed:'fixed'});
 const second=sampleBlindPairs(rows.slice().reverse(),{target:5,seed:'fixed'});
 assert.deepEqual(first.blind.pairs.map(p=>p.pairId),second.blind.pairs.map(p=>p.pairId));
 assert.deepEqual(first.manifest.strata,second.manifest.strata);
});
test('source revisions produce a different blind pair identity',()=>{
 const a=pair(1,2);
 const b={...a,right_hash:'c'.repeat(64)};
 const original=sampleBlindPairs([a]).blind.pairs[0].pairId;
 const changed=sampleBlindPairs([b]).blind.pairs[0].pairId;
 assert.notEqual(original,changed);
});
test('prepared annotator templates intentionally carry no answers',()=>{
 const blind=sampleBlindPairs([pair(1,2)]).blind;
 const a=createAnnotationTemplate(blind,'reviewer-a');
 const b=createAnnotationTemplate(blind,'reviewer-b');
 assert.equal(a.annotations[0].label,null);
 assert.equal(b.annotations[0].reason,null);
 assert.notEqual(a.reviewer,b.reviewer);
 assert.throws(()=>createAnnotationTemplate(blind,'!'),/Reviewer pseudonym/);
});
test('two reviewers can disagree or skip without producing false accuracy claims',()=>{
 const blind=sampleBlindPairs([pair(1,2),pair(3,4)],{target:2}).blind;
 const a=createAnnotationTemplate(blind,'person-a');
 const b=createAnnotationTemplate(blind,'person-b');
 a.annotations[0].label='same_problem';a.annotations[0].reason='Same underlying issue';
 b.annotations[0].label='different_problem';b.annotations[0].reason='Different failure modes';
 const summary=evaluateIndependentReviews(blind,a,b);
 assert.equal(summary.counts.disagreements,1);
 assert.equal(summary.counts.unanswered,1);
 assert.equal(summary.precision,null);
 assert.equal(summary.readyToPublishAsIndependentlyVerified,false);
});
test('performance metrics use only two independently supplied agreeing labels',()=>{
 const blind=sampleBlindPairs([pair(1,2),pair(3,4)],{target:2}).blind;
 const a=createAnnotationTemplate(blind,'person-a');
 const b=createAnnotationTemplate(blind,'person-b');
 for(const list of [a,b]){
  list.annotations[0].label='same_problem';list.annotations[0].reason='Same failure';
  list.annotations[1].label='different_problem';list.annotations[1].reason='Different failures';
 }
 const r=evaluateIndependentReviews(blind,a,b,{predictions:[
  {pairId:a.annotations[0].pairId,verdict:'same_problem'},
  {pairId:a.annotations[1].pairId,verdict:'same_problem'}
 ]});
 assert.deepEqual(r.confusion,{tp:1,fp:1,tn:0,fn:0,missingPredictions:0});
 assert.equal(r.precision,0.5);
 assert.equal(r.recall,1);
 assert.equal(r.eligibleForExternalBenchmarkReview,true);
 assert.equal(r.readyToPublishAsIndependentlyVerified,false);
});
test('an automated reviewer cannot masquerade as a second reviewer ID',()=>{
 const blind=sampleBlindPairs([pair(1,2)]).blind;
 const a=createAnnotationTemplate(blind,'person-a');
 assert.throws(()=>evaluateIndependentReviews(blind,a,a),/pseudonyms must differ/);
 a.annotations[0].label='yes';
 assert.throws(()=>parseReviewerAnnotations(blind,a),/Invalid reviewer label/);
});
test('holdout query uses source-current embeddings without model decision labels',async()=>{
 const database={query:async(sql,args)=>{
  assert.equal(sql,HOLDOUT_PAIR_POOL_SQL);
  assert.deepEqual(args,[100,'seed','all-minilm']);
  assert.match(sql,/m\.source_content_hash=o\.content_hash/);
  return {rows:[pair(1,2)]};
 }};
 const report=await prepareHoldout(database,{maxNodes:100,target:1,seed:'seed',excludeDev:false});
 assert.equal(report.manifest.selected,1);
 assert.equal(report.blind.pairs.length,1);
});

test('previously LLM-reviewed pairs are never included in the blind pool',()=>{
 const data=[pair(1,2,{similarity:0.95}),pair(3,4,{similarity:0.8})];
 const result=sampleBlindPairs(data,{target:2,reviewedPairs:[['github:1','github:2']]});
 assert.equal(result.manifest.filtered.previouslyJudged,1);
 assert.equal(result.blind.pairs.length,1);
 assert.equal(result.blind.pairs[0].left.observationId,'github:3');
});
test('challenge-first sampler does not bury high similarity in a sea of easy negatives',()=>{
 const data=[pair(1,2,{similarity:0.8}),pair(2,3,{similarity:0.4}),...Array.from({length:50},(_,i)=>pair(i+10,i+100,{similarity:0.1}))];
 const result=sampleBlindPairs(data,{target:10,seed:'balanced-test'});
 assert.equal(result.manifest.challengeBands.near_miss_candidate,1);
 assert.equal(result.manifest.challengeBands.ambiguous_candidate,1);
 assert.ok(result.manifest.challengeBands.easy_negative_candidate>0);
 assert.equal(result.blind.independentHoldout,false);
 assert.ok(!JSON.stringify(result.blind).includes('challengeBands'));
});
test('source-current holdout SQL prevents leakage from old model-reviewed pairs',()=>{
 assert.match(HOLDOUT_PAIR_POOL_SQL,/NOT EXISTS \([\s\S]*FROM corroboration_edges previously_reviewed/);
 assert.match(HOLDOUT_PAIR_POOL_SQL,/previously_reviewed\.right_observation=a\.id/);
});
test('frozen holdout export cannot replace an existing annotation queue',async()=>{
 const {writePreparedHoldout}=await import('../packages/agents/holdout.mjs');
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const folder=await mkdtemp(join(tmpdir(),'pie-holdout-protect-'));
 try{
  const prefix=join(folder,'immutable');
  const report=sampleBlindPairs([pair(1,2)],{target:1});
  const outputs=await writePreparedHoldout(report,prefix);
  const content=await readFile(outputs.blind,'utf8');
  await assert.rejects(writePreparedHoldout(report,prefix),/Frozen holdout already exists/);
  assert.equal(await readFile(outputs.blind,'utf8'),content);
 }finally{await rm(folder,{recursive:true,force:true});}
});
