import test from 'node:test';
import assert from 'node:assert/strict';
import {accountKey} from '../packages/connectors/identity.mjs';
import {fetchGithubConversation,fetchHackerNewsConversation} from '../packages/connectors/conversations.mjs';
import {saveConversationMessages} from '../packages/storage/conversations.mjs';
test('pseudonymous account identity is stable per service, never the raw username',()=>{
 const github=accountKey('github','person-one');
 assert.equal(github.length,64);
 assert.equal(github,accountKey('github','person-one'));
 assert.notEqual(github,accountKey('hackernews','person-one'));
 assert.notEqual(github,'person-one');
});
test('GitHub comments retain root thread and account identity',async()=>{
 const observation={id:'github:11',source:'github',url:'https://github.com/acme/app/issues/11'};
 const items=[{id:101,body:'Large uploads fail every week',user:{id:9},html_url:'https://github.com/acme/app/issues/11#issuecomment-101',created_at:'2026-01-01T00:00:00Z'},{id:102,body:'I see this too',user:{id:10}}];
 let requested;
 const replies=await fetchGithubConversation(observation,{maxReplies:3,fetcher:async(url,opts)=>{requested=url;assert.ok(opts.headers.Accept);return {ok:true,json:async()=>items};}});
 assert.match(requested,/repos\/acme\/app\/issues\/11\/comments/);
 assert.deepEqual(replies.map(x=>x.parentId),['github:11','github:11']);
 assert.equal(new Set(replies.map(x=>x.authorKey)).size,2);
 assert.equal(replies[0].observationId,'github:11');
});
test('Hacker News conversations preserve reply parent and root, not one root per comment',async()=>{
 const fixture={1:{id:1,type:'story',kids:[2,3]},2:{id:2,type:'comment',text:'The integration fails',by:'alice',kids:[4]},3:{id:3,type:'comment',text:'This is useful',by:'bob'},4:{id:4,type:'comment',text:'I agree',by:'alice'}};
 const replies=await fetchHackerNewsConversation({id:'hackernews:1',source:'hackernews'},{maxReplies:10,fetcher:async url=>({ok:true,json:async()=>fixture[Number(url.match(/\/(\d+)\.json/)[1])]})});
 assert.equal(replies.length,3);
 assert.deepEqual(new Set(replies.map(x=>x.observationId)),new Set(['hackernews:1']));
 assert.equal(replies.find(x=>x.id==='hackernews-comment:4').parentId,'hackernews-comment:2');
 assert.equal(new Set(replies.map(x=>x.authorKey)).size,2);
});
test('conversation persistence rolls back on error',async()=>{
 const statements=[];
 const pool={connect:async()=>({release(){},query:async(sql)=>{statements.push(sql);if(sql.startsWith('INSERT'))throw Error('db failed');}})};
 const m={id:'github-comment:7',observationId:'github:1',parentId:'github:1',source:'github',url:'https://github.com/a/b/issues/1',body:'failure',contentHash:'a'.repeat(64)};
 await assert.rejects(saveConversationMessages(pool,[m]),/db failed/);
 assert.equal(statements.at(-1),'ROLLBACK');
});
