export async function saveConversationMessages(pool,messages){
 if(!Array.isArray(messages))throw new TypeError('Expected conversation messages');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const m of messages){
   if(!m?.id||!m.observationId||!m.parentId||!m.url?.startsWith('https://')||!m.contentHash)throw Error('Invalid conversation message');
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
  await client.query('COMMIT');
  return {received:messages.length};
 }catch(e){await client.query('ROLLBACK');throw e;}
 finally{client.release();}
}
