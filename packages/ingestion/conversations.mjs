import {createPool} from '../storage/postgres.mjs';
import {fetchConversation} from '../connectors/conversations.mjs';
import {saveConversationMessages} from '../storage/conversations.mjs';
export async function ingestConversations(pool,{limit=8,maxReplies=25,fetcher=fetch,token=process.env.GITHUB_TOKEN,observationIds=[]}={}){
 if(!Number.isInteger(limit)||limit<0||limit>100)throw RangeError('Invalid root limit');
 if(!Number.isInteger(maxReplies)||maxReplies<0||maxReplies>100)throw RangeError('Invalid reply limit');
 const {rows}=observationIds.length
  ?await pool.query('SELECT id,source,title,body,url,reporter_key FROM observations WHERE id=ANY($1::text[]) ORDER BY id',[observationIds])
  :await pool.query('SELECT id,source,title,body,url,reporter_key FROM observations ORDER BY published_at DESC NULLS LAST,id LIMIT $1',[limit]);
 const results=[];
 for(const observation of rows){
  try{
   const replies=await fetchConversation(observation,{fetcher,token,maxReplies});
   const saved=await saveConversationMessages(pool,replies);
   const accounts=new Set(replies.map(x=>x.authorKey).filter(Boolean));
   results.push({observationId:observation.id,status:'success',replies:saved.received,distinctReplyAccounts:accounts.size,capped:replies.length>=maxReplies});
  }catch(error){
   results.push({observationId:observation.id,status:'error',error:String(error?.message||error).slice(0,180)});
  }
 }
 return {roots:rows.length,replies:results.reduce((n,r)=>n+(r.replies||0),0),failed:results.filter(x=>x.status==='error').length,results};
}
if(process.argv[1]?.endsWith('/packages/ingestion/conversations.mjs')){
 const ids=(process.env.PIE_THREAD_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
 const pool=createPool();
 try{
  const summary=await ingestConversations(pool,{observationIds:ids,limit:Number(process.env.PIE_THREADS_LIMIT||8),maxReplies:Number(process.env.PIE_REPLIES_PER_THREAD||25)});
  console.log(JSON.stringify(summary));
  if(summary.failed)process.exitCode=1;
 }finally{await pool.end();}
}
