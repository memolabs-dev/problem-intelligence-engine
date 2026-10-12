import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestSources } from '../packages/ingestion/pipeline.mjs';

test('ingests GitHub and Hacker News with provenance and deduplication', async () => {
 const calls=[];
 const client={query:async (sql,params)=>{calls.push([sql,params]);}};
 const fetcher=async url=>({ok:true,json:async()=>url.includes('github.com')?[{id:12,html_url:'https://github.com/acme/app/issues/12',title:'Pain',body:'Slow',created_at:'2026-01-01T00:00:00Z'}]:{id:77,type:'ask',title:'Ask HN: better tool?',text:'Need it',time:1767225600}});
 const result=await ingestSources(client,{github:['acme/app','acme/app'],hackerNewsIds:[77,77],fetcher});
 assert.deepEqual(result,{fetched:4,unique:2});
 assert.equal(calls.filter(([sql])=>sql.startsWith('INSERT')).length,2);
 assert.deepEqual(calls.map(([sql])=>sql).filter(sql=>!sql.startsWith('INSERT')),['BEGIN','COMMIT']);
});
test('rejects malformed repositories',async()=>{const client={query:async()=>{}};await assert.rejects(ingestSources(client,{github:['invalid']}),/Invalid GitHub repository/)});
