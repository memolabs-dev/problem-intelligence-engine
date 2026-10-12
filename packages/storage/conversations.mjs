/**
 * Writes observations on an existing PostgreSQL transaction. A checkpoint
 * must commit in that same transaction, never ahead of saved replies.
 */
export async function writeConversationMessages(client,messages){
 if(!Array.isArray(messages))throw new TypeError('Expected conversation messages');
 for(const m of messages){
  if(!m?.id||!m.observationId||!m.parentId||!m.url?.startsWith('https://')||
    !['github','hackernews'].includes(m.source)||!m.contentHash||!m.body?.trim())throw Error('Invalid conversation message');
  await client.query(`INSERT INTO conversation_messages
   (id,observation_id,parent_id,source,author_key,url,body,published_at,content_hash)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
   ON CONFLICT(id) DO UPDATE SET
   parent_id=EXCLUDED.parent_id,author_key=EXCLUDED.author_key,
   url=EXCLUDED.url,body=EXCLUDED.body,published_at=EXCLUDED.published_at,
   content_hash=EXCLUDED.content_hash,fetched_at=NOW()
   WHERE conversation_messages.content_hash IS DISTINCT FROM EXCLUDED.content_hash
   OR conversation_messages.author_key IS DISTINCT FROM EXCLUDED.author_key`,
   [m.id,m.observationId,m.parentId,m.source,m.authorKey??null,m.url,m.body,m.publishedAt??null,m.contentHash]);
 }
}
export async function saveConversationMessages(pool,messages){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await writeConversationMessages(client,messages);
  await client.query('COMMIT');
  return {received:messages.length};
 }catch(e){await client.query('ROLLBACK');throw e;}
 finally{client.release();}
}
export async function readConversationCheckpoint(pool,observationId){
 const {rows}=await pool.query('SELECT source,cursor,status,processed_count,last_error FROM conversation_ingestion_state WHERE observation_id=$1',[observationId]);
 return rows[0]||null;
}
/** Message upserts and cursor progression are one atomic unit of work. */
export async function saveConversationPage(pool,observation,{messages=[],processed=0,status,cursor,lastError=null}={}){
 if(!observation?.id||!['github','hackernews'].includes(observation.source)||!Array.isArray(messages))throw Error('Invalid conversation page');
 if(!['partial','complete','error'].includes(status)||!Number.isInteger(processed)||processed<0||processed>100)throw Error('Invalid checkpoint status/budget');
 if(status==='partial'&&(!cursor||cursor.kind!==observation.source))throw Error('Partial checkpoint requires valid source cursor');
 if(status==='complete'&&cursor!==null)throw Error('Complete checkpoint must not retain a cursor');
 if(messages.some(m=>m.observationId!==observation.id||m.source!==observation.source))throw Error('Message root or source mismatch');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await writeConversationMessages(client,messages);
  await client.query(`INSERT INTO conversation_ingestion_state
   (observation_id,source,cursor,status,processed_count,last_error)
   VALUES ($1,$2,$3::jsonb,$4,$5,$6)
   ON CONFLICT(observation_id) DO UPDATE SET
    source=EXCLUDED.source,cursor=EXCLUDED.cursor,status=EXCLUDED.status,
    processed_count=conversation_ingestion_state.processed_count+EXCLUDED.processed_count,
    last_error=EXCLUDED.last_error,updated_at=NOW()`,
   [observation.id,observation.source,JSON.stringify(cursor),status,processed,lastError]);
  await client.query('COMMIT');
  return {received:messages.length,processed,status};
 }catch(error){await client.query('ROLLBACK');throw error;}
 finally{client.release();}
}
