import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchGitHubConversationPage,fetchHackerNewsConversationPage,fetchPublicJSON} from '../packages/connectors/conversation-pages.mjs';
import {ingestConversations} from '../packages/ingestion/conversations.mjs';
import {saveConversationPage,readConversationCheckpoint} from '../packages/storage/conversations.mjs';

const github={id:'github:1',source:'github',url:'https://github.com/acme/app/issues/1'};
const comment=id=>({id,body:'Reproduced the upload failure at size '+id,user:{id:100+id},created_at:'2026-10-01T10:00:00Z'});
test('GitHub page cursor resumes across a page boundary without missing messages',async()=>{
 const calls=[];
 const fetcher=async url=>{
  const page=Number(new URL(url).searchParams.get('page'));
  calls.push(page);
  return {ok:true,json:async()=>page===1?Array.from({length:100},(_,i)=>comment(i+1)):[comment(101),comment(102)]};
 };
 let cursor=null;
 const seen=[];
 for(let i=0;i<3;i++){
  const chunk=await fetchGitHubConversationPage(github,{cursor,fetcher,maxReplies:40});
  seen.push(...chunk.messages.map(m=>m.id));
  cursor=chunk.cursor;
  if(i<2)assert.equal(chunk.status,'partial');
  else assert.equal(chunk.status,'complete');
 }
 assert.equal(seen.length,102);
 assert.equal(new Set(seen).size,102);
 assert.deepEqual(calls,[1,1,1,2]);
 assert.equal(cursor,null);
});
test('GitHub cursor cannot silently skip unread replies',async()=>{
 await assert.rejects(fetchGitHubConversationPage(github,{
  cursor:{kind:'github',page:1,offset:50},maxReplies:10,
  fetcher:async()=>({ok:true,json:async()=>[comment(1),comment(2)]})
 }),/offset exceeds page size/);
});
test('GitHub validates source and bounded batch size before external request',async()=>{
 let called=false;
 const fetcher=async()=>{called=true;throw Error('unexpected');};
 await assert.rejects(fetchGitHubConversationPage(github,{fetcher,maxReplies:1000}),/maxReplies/);
 await assert.rejects(fetchGitHubConversationPage({...github,url:'https://example.org/private'},{fetcher}),/GitHub issue URL/);
 assert.equal(called,false);
});
test('Hacker News cursor preserves nested parent relationships and can resume',async()=>{
 const fixtures={
  1:{id:1,type:'story',kids:[2,3]},
  2:{id:2,type:'comment',text:'My import failed repeatedly',by:'alice',kids:[4]},
  3:{id:3,type:'comment',text:'This exact issue happens to our org',by:'bob'},
  4:{id:4,type:'comment',text:'I also hit this bug',by:'alice'}
 };
 const calls=[];
 const fetcher=async url=>{const id=Number(url.match(/\/(\d+)\.json$/)[1]);calls.push(id);return {ok:true,json:async()=>fixtures[id]};};
 const o={id:'hackernews:1',source:'hackernews',url:'https://news.ycombinator.com/item?id=1'};
 const first=await fetchHackerNewsConversationPage(o,{fetcher,maxReplies:1});
 const second=await fetchHackerNewsConversationPage(o,{fetcher,maxReplies:1,cursor:first.cursor});
 const third=await fetchHackerNewsConversationPage(o,{fetcher,maxReplies:1,cursor:second.cursor});
 assert.equal(first.status,'partial');
 assert.equal(second.status,'partial');
 assert.equal(third.status,'complete');
 assert.deepEqual([...first.messages,...second.messages,...third.messages].map(x=>x.id),[
  'hackernews-comment:2','hackernews-comment:3','hackernews-comment:4'
 ]);
 assert.equal(third.messages[0].parentId,'hackernews-comment:2');
 assert.deepEqual(calls,[1,2,3,4]);
});
test('deleted Hacker News comments consume budget and do not erase surviving replies',async()=>{
 const fixtures={
  1:{id:1,type:'story',kids:[2,3]},
  2:{id:2,type:'comment',deleted:true},
  3:{id:3,type:'comment',text:'Works only in some projects',by:'alice'}
 };
 const fetcher=async url=>({ok:true,json:async()=>fixtures[Number(url.match(/\/(\d+)\.json$/)[1])]});
 const o={id:'hackernews:1',source:'hackernews'};
 const one=await fetchHackerNewsConversationPage(o,{fetcher,maxReplies:1});
 assert.equal(one.processed,1);
 assert.equal(one.messages.length,0);
 assert.equal(one.status,'partial');
 const two=await fetchHackerNewsConversationPage(o,{fetcher,maxReplies:1,cursor:one.cursor});
 assert.equal(two.status,'complete');
 assert.equal(two.messages.length,1);
});
test('transient 429 honors Retry-After and retries once; 403 fails immediately',async()=>{
 const delays=[];let attempts=0;
 const url='https://api.github.com/repos/acme/app/issues/1/comments';
 const result=await fetchPublicJSON(url,{sleeper:async ms=>delays.push(ms),fetcher:async()=>{
  attempts++;
  return attempts===1?{ok:false,status:429,headers:{get:()=> '1'}}:{ok:true,json:async()=>({ok:true})};
 }});
 assert.deepEqual(result,{ok:true});assert.deepEqual(delays,[1000]);assert.equal(attempts,2);
 await assert.rejects(fetchPublicJSON(url,{fetcher:async()=>({ok:false,status:403})}),/HTTP 403/);
});
test('checkpoint and messages share a transaction; any failure rolls back both',async()=>{
 const calls=[];
 const pool={connect:async()=>({release(){},query:async(sql)=>{
  calls.push(sql);
  if(sql.includes('INSERT INTO conversation_ingestion_state'))throw Error('Disk unavailable');
 }})};
 const payload={
  messages:[{id:'github-comment:1',observationId:'github:1',parentId:'github:1',
   source:'github',url:'https://github.com/acme/app/issues/1#issuecomment-1',
   body:'Upload fails every time',contentHash:'a'.repeat(64)}],
  processed:1,status:'partial',cursor:{kind:'github',page:1,offset:1}
 };
 await assert.rejects(saveConversationPage(pool,github,payload),/Disk unavailable/);
 assert.equal(calls[0],'BEGIN');
 assert.equal(calls.at(-1),'ROLLBACK');
 assert.ok(calls.some(sql=>sql.startsWith('INSERT INTO conversation_messages')));
});
test('ingestion resumes saved cursor and skips fully collected discussions unless refreshed',async()=>{
 const ids=[{id:'github:1',source:'github',url:github.url},{id:'github:2',source:'github',url:'https://github.com/acme/app/issues/2'}];
 const calls=[];
 const pool={query:async()=>({rows:ids})};
 const checkpoints={
  'github:1':{source:'github',status:'partial',cursor:{kind:'github',page:2,offset:0}},
  'github:2':{source:'github',status:'complete',cursor:null}
 };
 const report=await ingestConversations(pool,{
  observationIds:ids.map(x=>x.id),maxReplies:2,
  readCheckpoint:async(_pool,id)=>checkpoints[id],
  fetchPage:async(_row,opts)=>{calls.push(opts.cursor);return {messages:[],processed:0,status:'complete',cursor:null};},
  savePage:async(_pool,_obs,chunk)=>({status:chunk.status,received:0,processed:chunk.processed})
 });
 assert.equal(report.roots,2);
 assert.equal(report.completed,2);
 assert.deepEqual(calls,[{kind:'github',page:2,offset:0}]);
 assert.equal(report.results[1].skipped,true);
});
test('ingestion failure records last checkpoint instead of advancing to a lost page',async()=>{
 const observation={id:'github:1',source:'github',url:github.url};
 const cursor={kind:'github',page:3,offset:75};
 let saved;
 const report=await ingestConversations({query:async()=>({rows:[observation]})},{
  observationIds:['github:1'],readCheckpoint:async()=>({source:'github',cursor,status:'partial'}),
  fetchPage:async()=>{throw Error('Upstream temporarily unavailable');},
  savePage:async(_pool,_o,chunk)=>{saved=chunk;return {status:chunk.status,received:0,processed:0};}
 });
 assert.equal(report.failed,1);
 assert.equal(saved.status,'error');
 assert.deepEqual(saved.cursor,cursor);
 assert.equal(saved.processed,0);
});
test('invalid checkpoint and output flags fail closed',async()=>{
 await assert.rejects(saveConversationPage({connect:async()=>{throw Error('Not expected');}},github,{status:'partial',cursor:null}),/Partial checkpoint/);
 await assert.rejects(fetchHackerNewsConversationPage({id:'hackernews:1'},{cursor:{kind:'github',page:1}}),/Invalid Hacker News checkpoint/);
});
