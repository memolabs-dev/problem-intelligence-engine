import test from 'node:test';
import assert from 'node:assert/strict';
import {assessHoldoutQuality} from '../packages/agents/holdout-quality.mjs';
import {sampleBlindPairs} from '../packages/agents/holdout.mjs';

function pair(a,b,similarity=0.7,{leftSource='github',rightSource='hackernews'}={}){
 return {left_id:'github:'+a,right_id:'hackernews:'+b,left_title:'Issue '+a,
 right_title:'Issue '+b,left_body:'This behavior fails our workflow',right_body:'Our workflow fails in a similar way',
 left_source:leftSource,right_source:rightSource,left_url:'https://github.com/owner/repo/issues/'+a,
 right_url:'https://news.ycombinator.com/item?id='+b,left_account:'account-'+a,right_account:'account-'+b,
 left_hash:'a'.repeat(64),right_hash:'b'.repeat(64),similarity};
}
test('quality preflight rejects a misleading 150-line benchmark with no hard candidates',()=>{
 const rows=Array.from({length:180},(_,i)=>pair(i+1,i+101,0.12));
 const {blind,manifest}=sampleBlindPairs(rows,{target:150});
 const result=assessHoldoutQuality(blind,manifest);
 assert.equal(result.counts.pairs,150);
 assert.equal(result.status,'needs_more_candidates');
 assert.ok(result.blockers.includes('too_few_high_similarity_candidates'));
 assert.equal(result.modelAccuracyEstablished,false);
 assert.equal(result.independentValidationAchieved,false);
});
test('a diverse pool can be eligible for labeling but never instantly validated',()=>{
 const rows=[
  ...Array.from({length:20},(_,i)=>pair(i+1,i+101,0.75)),
  ...Array.from({length:35},(_,i)=>pair(i+1001,i+1101,0.48)),
  ...Array.from({length:110},(_,i)=>pair(i+2001,i+2101,0.19))
 ];
 const {blind,manifest}=sampleBlindPairs(rows,{target:150,devIds:['github:unseen']});
 const result=assessHoldoutQuality(blind,manifest,{policy:{
  minimumPairs:150,minimumHighSimilarity:10,minimumMediumSimilarity:20,
  minimumCrossPlatform:10,maximumSourceShare:0.3
 }});
 assert.equal(result.status,'ready_for_human_annotation');
 assert.equal(result.independentValidationAchieved,false);
 assert.equal(result.modelAccuracyEstablished,false);
});
test('source concentration triggers a transparent warning',()=>{
 const rows=Array.from({length:80},(_,i)=>pair('same',i+101,0.75));
 const {blind,manifest}=sampleBlindPairs(rows,{target:45});
 const result=assessHoldoutQuality(blind,manifest,{policy:{
  minimumPairs:1,minimumHighSimilarity:0,minimumMediumSimilarity:0,minimumCrossPlatform:0,
  maximumSourceShare:0.2
 }});
 assert.ok(result.blockers.includes('source_concentration_too_high'));
});
test('detects tampered audit files and duplicate source pairs',()=>{
 const {blind,manifest}=sampleBlindPairs([pair(1,2)],{target:1});
 const changed=structuredClone(manifest);
 changed.selections[0].pairId='0'.repeat(24);
 assert.equal(assessHoldoutQuality(blind,changed).status,'invalid');
 const repeated=structuredClone(blind);
 repeated.pairs.push(structuredClone(repeated.pairs[0]));
 assert.equal(assessHoldoutQuality(repeated,manifest).status,'invalid');
});
test('holds uncertain content in source references instead of treating similarity as an answer',()=>{
 const {blind,manifest}=sampleBlindPairs([pair(1,2,0.99)],{target:1});
 const score=assessHoldoutQuality(blind,manifest);
 assert.equal(score.counts.highSimilarityCandidates,1);
 assert.equal(score.modelAccuracyEstablished,false);
 assert.ok(!JSON.stringify(score).includes('"precision"'));
});

test('Hacker News reply without a title remains valid when its body is present',()=>{
 const {blind,manifest}=sampleBlindPairs([pair(1,2)],{target:1});
 blind.pairs[0].right.title='';
 const assessment=assessHoldoutQuality(blind,manifest);
 assert.notEqual(assessment.status,'invalid');
 assert.ok(!assessment.blockers.includes('missing_source_content'));
});
