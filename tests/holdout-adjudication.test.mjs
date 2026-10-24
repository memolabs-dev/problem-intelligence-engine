import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAdjudication,finalizeAdjudication} from '../packages/agents/holdout-adjudication.mjs';
const p=id=>({pairId:String(id).padStart(24,'a'),left:{observationId:'github:'+id,url:'https://github.com/a/b/issues/'+id,title:'Issue A',body:'Original'},right:{observationId:'hackernews:'+id,url:'https://news.ycombinator.com/item?id='+id,title:'Issue B',body:'Another'}});
const blind={kind:'unlabeled_human_annotation_queue',target:3,pairs:[p(1),p(2),p(3)]};
const submission=(reviewer,labels)=>({kind:'human_pair_annotations',reviewer,annotations:blind.pairs.map((p,i)=>({pairId:p.pairId,label:labels[i],reason:labels[i]?'Reasoning '+i:null}))});
const A=submission('reviewer-a',['same_problem','different_problem','uncertain']);
const B=submission('reviewer-b',['different_problem','different_problem',null]);
test('disagreement and unanswered judgments become empty human adjudication entries',()=>{
 const q=prepareAdjudication(blind,A,B);
 assert.equal(q.items.length,2);
 assert.deepEqual(q.items.map(x=>x.label),[null,null]);
 assert.equal(q.items[0].left.observationId,'github:1');
 assert.equal(q.reviewDigests.length,2);
 assert.ok(!JSON.stringify(q).includes('similarity'));
});
test('complete adjudication reports metrics without claiming independently authenticated humans',()=>{
 const q=prepareAdjudication(blind,A,B);
 q.items[0].label='same_problem';q.items[0].reason='Same concrete failure';
 q.items[1].label='uncertain';q.items[1].reason='Not enough details';
 const result=finalizeAdjudication(blind,A,B,q,{predictions:[{pairId:p(1).pairId,verdict:'different_problem'},
  {pairId:p(2).pairId,verdict:'different_problem'}]});
 assert.equal(result.disagreementsResolved,2);
 assert.deepEqual(result.confusion,{tp:0,fp:0,tn:1,fn:1,missingPredictions:0});
 assert.equal(result.precision,null);
 assert.equal(result.recall,0);
 assert.equal(result.independentHumansAuthenticated,false);
 assert.equal(result.independentBenchmarkVerified,false);
});
test('rejects tampered frozen inputs and prevents omitted or fabricated adjudications',()=>{
 const q=prepareAdjudication(blind,A,B);
 q.items[0].label='same_problem';q.items[0].reason='Evidence';
 assert.throws(()=>finalizeAdjudication(blind,A,B,q),/incomplete/);
 q.items[1].label='uncertain';q.items[1].reason='Reason';
 assert.throws(()=>finalizeAdjudication({...blind,target:4},A,B,q),/does not match/);
 assert.throws(()=>finalizeAdjudication(blind,A,{...B,reviewer:'changed'},q),/does not match/);
 q.items.push({...q.items[0]});
 assert.throws(()=>finalizeAdjudication(blind,A,B,q),/does not match/);
});
test('reviewer pseudonym alone cannot qualify as independent human evidence',()=>{
 assert.throws(()=>prepareAdjudication(blind,A,{...B,reviewer:'reviewer-a'}),/Distinct reviewer/);
});

test('adjudication queue snapshots are detached from frozen blind evidence',()=>{
 const before=structuredClone(blind.pairs[0].left);
 const queue=prepareAdjudication(blind,A,B);
 queue.items[0].left.body='A misleading replacement excerpt';
 assert.deepEqual(blind.pairs[0].left,before);
 assert.notDeepEqual(queue.items[0].left,before);
});

test('finalization rejects changes to any frozen source snapshot or queue structure',()=>{
 const mutations=[
  q=>{q.items[0].left.body='Different observed failure';},
  q=>{q.items[0].right.url='https://example.com/other';},
  q=>{delete q.items[0].right.title;},
  q=>{q.items[0].left.extra='fabricated';},
  q=>{q.items[0].unexpected='unfrozen';},
  q=>{q.items[0].left=structuredClone(q.items[1].left);}
 ];
 for(const mutate of mutations){
  const queue=prepareAdjudication(blind,A,B);
  queue.items[0].label='same_problem';queue.items[0].reason='Same failure';
  queue.items[1].label='uncertain';queue.items[1].reason='Insufficient detail';
  mutate(queue);
  assert.throws(()=>finalizeAdjudication(blind,A,B,queue),/source snapshot differs/);
 }
});
