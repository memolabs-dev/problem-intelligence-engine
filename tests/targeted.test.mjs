import test from 'node:test';
import assert from 'node:assert/strict';
import {validateResearchQuery,searchPublicGitHub,searchPublicHackerNews,runTargetedDiscovery} from '../packages/ingestion/targeted.mjs';

function mockFetch(url){
 if(url.startsWith('https://api.github.com/search/issues')){
  return Promise.resolve({ok:true,json:async()=>({items:[
   {id:101,html_url:'https://github.com/a/b/issues/3',title:'Turbopack ignores named chunks',body:'Dynamic imports lose naming metadata',user:{id:42}},
   {id:102,html_url:'https://github.com/a/b/pull/4',pull_request:{url:'https://api.github.com/repos/a/b/pulls/4'},title:'PR'}
  ]})});
 }
 if(url.startsWith('https://hn.algolia.com/api/v1/search')){
  return Promise.resolve({ok:true,json:async()=>({hits:[{objectID:'601',title:'Ask HN: Why are dynamic chunks unnamed?',story_text:'Turbopack migration loses chunk names.',author:'user-one',created_at_i:1720000000}]})});
 }
 throw Error('Unexpected external endpoint '+url);
}
test('targeted search validates bounded, specific queries',()=>{
 assert.equal(validateResearchQuery('  Turbopack   ignored chunk naming  '),'Turbopack ignored chunk naming');
 assert.throws(()=>validateResearchQuery('tiny'),/8..180/);
 assert.throws(()=>validateResearchQuery(15),/text query/);
});
test('public search connectors normalize the same provenance as baseline ingestion',async()=>{
 const a=await searchPublicGitHub('webpackChunkName ignored',{fetcher:mockFetch,limit:2});
 const b=await searchPublicHackerNews('webpackChunkName ignored',{fetcher:mockFetch,limit:2});
 assert.equal(a.length,1);assert.equal(a[0].id,'github:101');assert.equal(a[0].reporterKey.length,64);
 assert.equal(b.length,1);assert.equal(b[0].id,'hackernews:601');assert.equal(b[0].reporterKey.length,64);
});
test('targeted discovery persists unverified raw observations only once',async()=>{
 let captured;
 const report=await runTargetedDiscovery(null,'webpackChunkName ignored',{
  fetcher:mockFetch,perSource:2,persist:async(_pool,rows)=>{captured=rows;}
 });
 assert.equal(captured.length,2);
 assert.equal(report.uniqueObservations,2);
 assert.equal(report.incomplete,false);
 assert.equal(report.qualification,'unreviewed_source_observations');
});
test('partial provider failure is explicit and does not block valid source ingestion',async()=>{
 let saved;
 const fetcher=async url=>url.startsWith('https://api.github.com')?{ok:false,status:429}:mockFetch(url);
 const r=await runTargetedDiscovery(null,'webpackChunkName ignored',{
  fetcher,persist:async(_pool,rows)=>{saved=rows;}
 });
 assert.equal(r.incomplete,true);
 assert.equal(r.sources[0].status,'error');
 assert.equal(saved.length,1);
});
test('invalid search cannot make network calls',async()=>{
 let calls=0;
 await assert.rejects(runTargetedDiscovery(null,'bad',{fetcher:()=>{calls++;}}),/8..180/);
 assert.equal(calls,0);
});


test('GitHub 403 rate-limit response is not treated as an empty result',async()=>{
 const fetcher=async url=>url.startsWith('https://api.github.com')?{
  ok:false,status:403,headers:{get:key=>key==='x-ratelimit-remaining'?'0':null},
  json:async()=>({message:'API rate limit exceeded'})
 }:mockFetch(url);
 const report=await runTargetedDiscovery(null,'Deno worker unref',{
  fetcher,persist:async()=>{}
 });
 assert.equal(report.incomplete,true);
 assert.equal(report.sources[0].status,'error');
 assert.equal(report.sources[0].reason,'rate_limited');
 assert.ok(report.sources[0].error.includes('results are incomplete'));
 assert.equal(report.sources[1].status,'ok');
});
test('GitHub rate-limit retry hints are bounded and 403 authorization is separate',async()=>{
 const {explainGitHubSearchFailure}=await import('../packages/ingestion/targeted.mjs');
 const limited=await explainGitHubSearchFailure({
  status:429,headers:{get:key=>key==='retry-after'?'36000':null}
 });
 assert.equal(limited.code,'rate_limited');
 assert.equal(limited.retryAfterSeconds,3600);
 const forbidden=await explainGitHubSearchFailure({
  status:403,headers:{get:()=>null},
  json:async()=>({message:'Resource not accessible by integration'})
 });
 assert.equal(forbidden.code,'http_error');
 assert.equal(forbidden.message,'GitHub search HTTP 403');
});
test('GitHub search remains authenticated only when caller explicitly supplies a token',async()=>{
 const {searchPublicGitHub}=await import('../packages/ingestion/targeted.mjs');
 let sent;
 await searchPublicGitHub('Deno worker unref',{
  token:'provided-in-test',
  fetcher:async(_url,opts)=>{sent=opts.headers.Authorization;return {ok:true,json:async()=>({items:[]})};}
 });
 assert.equal(sent,'Bearer provided-in-test');
});
