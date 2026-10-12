import test from 'node:test';
import assert from 'node:assert/strict';
import {saveTargetedSearchAudit} from '../packages/storage/targeted-audit.mjs';
import {runTargetedDiscovery} from '../packages/ingestion/targeted.mjs';

test('targeted search audit snapshots query, source status and the discovered source hash',async()=>{
 const statements=[];
 const pool={connect:async()=>({release(){},query:async(sql,params)=>{statements.push({sql,params});return {rowCount:1};}})};
 const report={query:'Search a concrete failure',matchedRaw:1,uniqueObservations:1,sources:[{source:'github',status:'ok',fetched:1},{source:'hackernews',status:'error'}]};
 const item={id:'github:1',contentHash:'a'.repeat(64)};
 const id=await saveTargetedSearchAudit(pool,report,[item]);
 assert.match(id,/^[a-f0-9-]{36}$/);
 assert.equal(statements[0].sql,'BEGIN');
 assert.equal(statements.at(-1).sql,'COMMIT');
 assert.equal(statements.find(x=>x.sql.includes('INSERT INTO targeted_search_hits')).params[2],item.contentHash);
});
test('failed audit rolls back its transaction',async()=>{
 const seen=[];
 const pool={connect:async()=>({release(){},query:async sql=>{seen.push(sql);if(sql.includes('INSERT INTO targeted_search_runs'))throw Error('Audit write failure');}})};
 await assert.rejects(saveTargetedSearchAudit(pool,{query:'long enough search',matchedRaw:0,uniqueObservations:0,sources:[]},[]),/Audit write failure/);
 assert.equal(seen.at(-1),'ROLLBACK');
});
test('multiple issues by one platform account never imply multiple independent people',async()=>{
 const fetcher=async url=>{
  if(url.includes('api.github.com'))return {ok:true,json:async()=>({items:[
   {id:101,title:'Turbopack drops chunk name',body:'Chunks are unnamed',html_url:'https://github.com/a/b/issues/1',user:{id:7}},
   {id:102,title:'Dynamic chunk name ignored',body:'The same setup still fails',html_url:'https://github.com/a/b/issues/2',user:{id:7}}
  ]})};
  return {ok:true,json:async()=>({hits:[]})};
 };
 const report=await runTargetedDiscovery(null,'Turbopack ignores chunk names',{fetcher,persist:async()=>{}});
 assert.equal(report.uniqueObservations,2);
 assert.equal(report.distinctSourceAccounts,1);
 assert.equal(report.repeatedPostsFromKnownAccounts,1);
 assert.equal(report.verifiedIndependentHumans,null);
});
