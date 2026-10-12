import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeOfflineAnnotationPage,validateBlindQueue,writeOfflineAnnotationPage} from '../packages/agents/annotation-ui.mjs';
import {sampleBlindPairs} from '../packages/agents/holdout.mjs';

const pair={
 pairId:'a'.repeat(24),
 left:{observationId:'github:1',title:'A source issue',body:'A concrete workflow failure',url:'https://github.com/example/repo/issues/1',source:'github'},
 right:{observationId:'hackernews:2',title:'Similar issue',body:'Another report of workflow failure',url:'https://news.ycombinator.com/item?id=2',source:'hackernews'}
};
const queue={kind:'unlabeled_human_annotation_queue',target:1,independentHoldout:false,pairs:[pair]};
test('offline generated interface never exposes model scores or answers',()=>{
 const html=makeOfflineAnnotationPage(queue);
 assert.match(html,/Same problem/);
 assert.match(html,/Different problems/);
 assert.match(html,/Uncertain/);
 assert.match(html,/Export answers/);
 assert.match(html,/no.*model predictions/i);
 assert.ok(!html.includes('model similarity'));
 assert.ok(!html.includes('"similarity"'));
 assert.ok(!html.includes('same_problem\",\"right'));
 assert.match(html,/connect-src 'none'/);
});
test('embedding untrusted public HTML cannot close JSON script and insert executable markup',()=>{
 const unsafe=structuredClone(queue);
 unsafe.pairs[0].left.body='</script><script>alert("injected")</script><img src=x onerror=alert(1)>';
 const html=makeOfflineAnnotationPage(unsafe);
 assert.ok(!html.includes('</script><script>alert'));
 assert.ok(!html.includes('<img src=x'));
 assert.ok(html.includes('\\u003c/script\\u003e'));
 assert.match(html,/textContent=value\.body/);
});
test('annotation interface validates source URLs and unique pair IDs before rendering',()=>{
 assert.throws(()=>validateBlindQueue({kind:'wrong',pairs:[]}),/Expected/);
 const duplicated=structuredClone(queue);duplicated.pairs.push(structuredClone(pair));
 assert.throws(()=>makeOfflineAnnotationPage(duplicated),/duplicate pair ID/);
 const http=structuredClone(queue);http.pairs[0].right.url='javascript:alert(1)';
 assert.throws(()=>makeOfflineAnnotationPage(http),/Invalid source/);
});
test('offline reviewer file is private and cannot overwrite an existing annotation page',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pie-annotation-ui-'));
 try{
  const path=join(directory,'review.html');
  const info=await writeOfflineAnnotationPage(queue,path);
  assert.equal(info.pairs,1);
  assert.ok(info.bytes>1000);
  const html=await readFile(path,'utf8');
  assert.match(html,/pair review/i);
  await assert.rejects(writeOfflineAnnotationPage(queue,path),/EEXIST/);
  assert.equal(await readFile(path,'utf8'),html);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('offline reviewer consumes only a blind queue, not an audit manifest',()=>{
 assert.throws(()=>makeOfflineAnnotationPage({kind:'sampling_audit',selections:[]}),/Expected/);
});
