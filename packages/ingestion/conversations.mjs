import {createPool} from '../storage/postgres.mjs';
import {fetchConversationPage} from '../connectors/conversation-pages.mjs';
import {readConversationCheckpoint,saveConversationPage} from '../storage/conversations.mjs';

/**
 * One bounded checkpoint per root and invocation. Running the command again
 * resumes partial/error threads instead of silently starting from page 1.
 */
export async function ingestConversations(pool,{
 limit=8,maxReplies=25,maxDepth=4,fetcher=fetch,token=process.env.GITHUB_TOKEN,
 observationIds=[],refresh=false,readCheckpoint=readConversationCheckpoint,
 fetchPage=fetchConversationPage,savePage=saveConversationPage
}={}){
 if(!Number.isInteger(limit)||limit<0||limit>100)throw RangeError('Invalid root limit');
 if(!Number.isInteger(maxReplies)||maxReplies<1||maxReplies>100)throw RangeError('Invalid reply limit');
 if(!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>10)throw RangeError('Invalid maximum thread depth');
 if(!Array.isArray(observationIds)||observationIds.length>100||observationIds.some(id=>typeof id!=='string'||!id))throw Error('Invalid observation IDs');
 const {rows}=observationIds.length
  ?await pool.query('SELECT id,source,title,body,url,reporter_key FROM observations WHERE id=ANY($1::text[]) ORDER BY id',[observationIds])
  :await pool.query('SELECT id,source,title,body,url,reporter_key FROM observations ORDER BY published_at DESC NULLS LAST,id LIMIT $1',[limit]);
 const results=[];
 for(const observation of rows){
  let state=null;
  try{
   state=await readCheckpoint(pool,observation.id);
   if(state?.status==='complete'&&!refresh){
    results.push({observationId:observation.id,status:'complete',replies:0,processed:0,skipped:true,resumed:false,capped:false});
    continue;
   }
   if(state?.source&&state.source!==observation.source)throw Error('Checkpoint source mismatch');
   const cursor=refresh?null:state?.cursor??null;
   const chunk=await fetchPage(observation,{cursor,fetcher,token,maxReplies,maxDepth});
   if(chunk.status!=='partial'&&chunk.status!=='complete')throw Error('Unexpected conversation fetch status');
   const saved=await savePage(pool,observation,chunk);
   const accounts=new Set(chunk.messages.map(x=>x.authorKey).filter(Boolean));
   results.push({
    observationId:observation.id,status:saved.status,replies:saved.received,processed:saved.processed,
    distinctReplyAccounts:accounts.size,resumed:cursor!==null,skipped:false,
    capped:chunk.status==='partial'
   });
  }catch(error){
   const message=String(error?.message||error).slice(0,180);
   try{
    // Preserve the last committed cursor. Never advance on a failed page.
    await savePage(pool,observation,{messages:[],processed:0,status:'error',cursor:refresh?null:state?.cursor??null,lastError:message});
   }catch(saveError){
    results.push({observationId:observation.id,status:'error',error:message,checkpointError:String(saveError?.message||saveError).slice(0,120)});
    continue;
   }
   results.push({observationId:observation.id,status:'error',error:message});
  }
 }
 return {
  roots:rows.length,replies:results.reduce((n,r)=>n+(r.replies||0),0),
  processed:results.reduce((n,r)=>n+(r.processed||0),0),
  partial:results.filter(x=>x.status==='partial').length,
  completed:results.filter(x=>x.status==='complete').length,
  failed:results.filter(x=>x.status==='error').length,results
 };
}
if(process.argv[1]?.endsWith('/packages/ingestion/conversations.mjs')){
 const ids=(process.env.PIE_THREAD_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
 const pool=createPool();
 try{
  const summary=await ingestConversations(pool,{
   observationIds:ids,limit:Number(process.env.PIE_THREADS_LIMIT||8),
   maxReplies:Number(process.env.PIE_REPLIES_PER_THREAD||25),
   maxDepth:Number(process.env.PIE_HN_MAX_DEPTH||4),
   refresh:process.env.PIE_THREADS_REFRESH==='1'
  });
  console.log(JSON.stringify(summary));
  if(summary.failed)process.exitCode=1;
 }finally{await pool.end();}
}
