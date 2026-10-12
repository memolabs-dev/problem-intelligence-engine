import test from 'node:test';
import assert from 'node:assert/strict';
import {observationGroup,selectForLLM} from '../packages/agents/select.mjs';

const item=(id,title,url)=>({id,title,body:'',url:url||'https://github.com/acme/app/issues/'+id.split(':')[1]});
test('identifies repository as source group',()=>{
 assert.equal(observationGroup(item('github:1','CSV parser fails')), 'github:acme/app');
 assert.equal(observationGroup({id:'hackernews:5',url:'https://news.ycombinator.com/item?id=5'}),'hackernews');
});
test('balanced sampling is reproducible across different input ordering',()=>{
 const items=Array.from({length:24},(_,i)=>item('github:'+i,i%2?'CSV parser fails on large files':'How does this tool work?','https://github.com/'+(i%3?'acme/app':'org/second')+'/issues/'+i));
 const a=selectForLLM(items,{limit:12});
 const b=selectForLLM(items.slice().reverse(),{limit:12});
 assert.deepEqual(a.rows.map(x=>x.id),b.rows.map(x=>x.id));
 assert.equal(a.rows.length,12);
 assert.ok(a.stats.chosenSignals>0);
 assert.ok(a.stats.chosenExploration>0);
 assert.ok(a.stats.groups.length>=2);
});
test('exploration covers prompts without explicit problem words',()=>{
 const items=[item('github:1','CSV parser fails on large files'),item('hackernews:2','How is everyone today?','https://news.ycombinator.com/item?id=2')];
 const sampled=selectForLLM(items,{limit:2,explorationFraction:0.5});
 assert.equal(sampled.stats.chosenSignals,1);
 assert.equal(sampled.stats.chosenExploration,1);
});
test('invalid sampler configuration is rejected',()=>{
 assert.throws(()=>selectForLLM([],{limit:0}),/Invalid/);
 assert.throws(()=>selectForLLM([],{explorationFraction:2}),/Invalid/);
});
