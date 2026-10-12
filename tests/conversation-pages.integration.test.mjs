import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPool,saveObservations} from '../packages/storage/postgres.mjs';
import {ingestConversations} from '../packages/ingestion/conversations.mjs';
import {readConversationCheckpoint} from '../packages/storage/conversations.mjs';

test('real PostgreSQL checkpoint resumes partial GitHub pages without duplicating stored replies',async t=>{
 if(process.env.PIE_INTEGRATION!=='1')return t.skip('set PIE_INTEGRATION=1 to run');
 const pool=createPool();
 const externalId='test-thread-'+process.pid;
 const id='github:'+externalId;
 const url='https://github.com/acme/app/issues/987654';
 const fixture=[
  {id:987650001,body:'The same upload error happens for us.',user:{id:1}},
  {id:987650002,body:'We have experienced a similar import failure.',user:{id:2}}
 ];
 let remoteFetches=0;
 const fetcher=async target=>{
  assert.equal(new URL(target).searchParams.get('page'),'1');
  remoteFetches++;
  return {ok:true,json:async()=>fixture};
 };
 try{
  await saveObservations(pool,[{id,source:'github',externalId,url,title:'Test root',body:'',publishedAt:null,
   contentHash:createHash('sha256').update('Test root').digest('hex')}]);
  const args={observationIds:[id],maxReplies:1,fetcher};
  const first=await ingestConversations(pool,args);
  assert.equal(first.partial,1);
  assert.equal(first.replies,1);
  const savedFirst=await readConversationCheckpoint(pool,id);
  assert.equal(savedFirst.status,'partial');
  assert.deepEqual(savedFirst.cursor,{kind:'github',page:1,offset:1});

  const second=await ingestConversations(pool,args);
  assert.equal(second.completed,1);
  assert.equal(second.replies,1);
  assert.equal(second.results[0].resumed,true);
  const savedSecond=await readConversationCheckpoint(pool,id);
  assert.equal(savedSecond.status,'complete');
  assert.equal(savedSecond.cursor,null);
  assert.equal(Number(savedSecond.processed_count),2);
  const stored=(await pool.query('SELECT id,parent_id,observation_id FROM conversation_messages WHERE observation_id=$1 ORDER BY id',[id])).rows;
  assert.deepEqual(stored.map(row=>row.id),['github-comment:987650001','github-comment:987650002']);
  assert.ok(stored.every(row=>row.parent_id===id));

  const skipped=await ingestConversations(pool,args);
  assert.equal(skipped.completed,1);
  assert.equal(skipped.results[0].skipped,true);
  assert.equal(remoteFetches,2);

  const refresh=await ingestConversations(pool,{...args,refresh:true,maxReplies:2});
  assert.equal(refresh.completed,1);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM conversation_messages WHERE observation_id=$1',[id])).rows[0].count,2);
 }finally{
  await pool.query('DELETE FROM observations WHERE id=$1',[id]);
  await pool.end();
 }
});
