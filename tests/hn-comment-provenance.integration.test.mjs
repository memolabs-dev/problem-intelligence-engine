import test from 'node:test';
import assert from 'node:assert/strict';
import {createPool,saveObservations} from '../packages/storage/postgres.mjs';
import {normalizeHackerNewsSearchComment} from '../packages/connectors/hackernews.mjs';

test('PostgreSQL stores HN comment root, comment evidence and distinct pseudonymous accounts',async t=>{
 if(process.env.PIE_INTEGRATION!=='1')return t.skip('set PIE_INTEGRATION=1');
 const db=createPool();
 const base=Number(process.pid)*100000+700000000;
 const hits=[{objectID:String(base+1),story_id:base+99,author:'alice',comment_text:'Our import process fails when workers cannot be released.',created_at_i:1750000000},
 {objectID:String(base+2),story_id:base+99,author:'bob',comment_text:'I cannot stop my workers after the operation finishes.',created_at_i:1750000000}];
 const normalized=hits.map(normalizeHackerNewsSearchComment);
 try{
  await saveObservations(db,normalized);
  const {rows}=await db.query('SELECT id,thread_root_id,reporter_key,body FROM observations WHERE id=ANY($1::text[]) ORDER BY id',[normalized.map(r=>r.id)]);
  assert.equal(rows.length,2);
  assert.equal(new Set(rows.map(x=>x.thread_root_id)).size,1);
  assert.ok(rows.every(x=>x.thread_root_id==='hackernews:'+(base+99)));
  assert.equal(new Set(rows.map(x=>x.reporter_key)).size,2);
  assert.equal(rows[0].body,normalized[0].body);
 }finally{
  await db.query('DELETE FROM observations WHERE id=ANY($1::text[])',[normalized.map(x=>x.id)]);
  await db.end();
 }
});
