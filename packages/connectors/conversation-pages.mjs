import {createHash} from 'node:crypto';
import {accountKey} from './identity.mjs';

/** One deliberately small, bounded batch per public conversation.
 * Cursors are plain JSON that PostgreSQL can persist atomically with messages.
 */
const hashBody=body=>createHash('sha256').update(body).digest('hex');
export function validatePageBudget(maxReplies){
 if(!Number.isInteger(maxReplies)||maxReplies<1||maxReplies>100)throw new RangeError('maxReplies must be 1..100');
}
function parseGitHubIssue(observation){
 if(!observation?.id?.startsWith('github:'))throw new Error('Expected GitHub root');
 const match=/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)(?:[/?#]|$)/.exec(String(observation.url||''));
 if(!match)throw new Error('Expected GitHub issue URL');
 return {owner:match[1],repo:match[2],issue:match[3]};
}
function validateGitHubCursor(cursor){
 if(cursor==null)return {kind:'github',page:1,offset:0};
 if(cursor.kind!=='github'||!Number.isSafeInteger(cursor.page)||cursor.page<1||
   !Number.isSafeInteger(cursor.offset)||cursor.offset<0||cursor.offset>99)throw Error('Invalid GitHub page cursor');
 return {kind:'github',page:cursor.page,offset:cursor.offset};
}
const isRetryableStatus=status=>[429,502,503,504].includes(status);
export async function fetchPublicJSON(url,{fetcher=fetch,headers={},sleeper=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxAttempts=2}={}){
 if(typeof url!=='string'||(!url.startsWith('https://api.github.com/')&&!url.startsWith('https://hacker-news.firebaseio.com/')))throw Error('Unsupported public source endpoint');
 if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw RangeError('Invalid maxAttempts');
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  let response;
  try{response=await fetcher(url,{headers,signal:AbortSignal.timeout(25000)});}
  catch(error){
   if(attempt===maxAttempts)throw error;
   await sleeper(1000*attempt);
   continue;
  }
  if(response.ok)return response.json();
  if(!isRetryableStatus(response.status)||attempt===maxAttempts)throw Error('Public source HTTP '+response.status);
  const seconds=Number(response.headers?.get?.('retry-after'));
  const delay=Number.isFinite(seconds)&&seconds>0?Math.min(seconds*1000,30000):Math.min(attempt*2000,10000);
  await sleeper(delay);
 }
 throw Error('Public source fetch retry limit exceeded');
}

export async function fetchGitHubConversationPage(observation,{cursor=null,maxReplies=25,fetcher=fetch,token,sleeper}={}){
 validatePageBudget(maxReplies);
 const {owner,repo,issue}=parseGitHubIssue(observation);
 let {page,offset}=validateGitHubCursor(cursor);
 const headers={Accept:'application/vnd.github+json','User-Agent':'problem-intelligence-engine'};
 if(token)headers.Authorization='Bearer '+token;
 const PER_PAGE=100;
 const messages=[];
 let processed=0;
 // With maxReplies <= 100 we can cross at most two API pages.
 for(let request=0;request<2;request++){
  const endpoint=`https://api.github.com/repos/${owner}/${repo}/issues/${issue}/comments?per_page=${PER_PAGE}&page=${page}`;
  const comments=await fetchPublicJSON(endpoint,{fetcher,headers,sleeper});
  if(!Array.isArray(comments)||comments.length>PER_PAGE)throw Error('Invalid GitHub comment page');
  if(offset>comments.length)throw Error('GitHub checkpoint offset exceeds page size');
  while(offset<comments.length&&processed<maxReplies){
   const c=comments[offset++];
   processed++;
   if(!c?.id||typeof c.body!=='string'||!c.body.trim())continue;
   const body=c.body;
   messages.push({
    id:'github-comment:'+c.id,observationId:observation.id,parentId:observation.id,source:'github',
    authorKey:accountKey('github',c.user?.id??null),
    url:c.html_url||observation.url+'#issuecomment-'+c.id,body,
    publishedAt:c.created_at||null,contentHash:hashBody(body)
   });
  }
  if(offset<comments.length)return {messages,processed,status:'partial',cursor:{kind:'github',page,offset}};
  if(comments.length<PER_PAGE)return {messages,processed,status:'complete',cursor:null};
  page++;
  offset=0;
  if(processed>=maxReplies)return {messages,processed,status:'partial',cursor:{kind:'github',page,offset}};
 }
 return {messages,processed,status:'partial',cursor:{kind:'github',page,offset}};
}

const MAX_QUEUED=20000;
function validateHNCursor(cursor,rootId){
 if(cursor==null)return null;
 if(cursor.kind!=='hackernews'||cursor.rootId!==rootId||!Array.isArray(cursor.queue)||!Array.isArray(cursor.seen))throw Error('Invalid Hacker News checkpoint');
 if(cursor.queue.length>MAX_QUEUED||cursor.seen.length>MAX_QUEUED)throw Error('Hacker News checkpoint exceeds safety limit');
 const queue=cursor.queue.map(x=>{
  if(!/^\d+$/.test(String(x?.id||''))||!Number.isInteger(x.depth)||x.depth<1||x.depth>10||typeof x.parentId!=='string')throw Error('Invalid Hacker News checkpoint node');
  return {id:String(x.id),depth:x.depth,parentId:x.parentId};
 });
 const seen=cursor.seen.map(id=>{
  if(!/^\d+$/.test(String(id)))throw Error('Invalid Hacker News seen ID');
  return String(id);
 });
 return {queue,seen};
}
export async function fetchHackerNewsConversationPage(observation,{cursor=null,maxReplies=25,maxDepth=4,fetcher=fetch,sleeper}={}){
 validatePageBudget(maxReplies);
 if(!observation?.id?.startsWith('hackernews:'))throw Error('Expected Hacker News root');
 if(!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>10)throw RangeError('Invalid HN depth');
 const rootId=observation.id.slice('hackernews:'.length);
 if(!/^\d+$/.test(rootId))throw Error('Expected numeric Hacker News root ID');
 const get=id=>fetchPublicJSON('https://hacker-news.firebaseio.com/v0/item/'+encodeURIComponent(id)+'.json',{fetcher,sleeper});
 const previous=validateHNCursor(cursor,rootId);
 let queue,seen;
 if(previous){queue=previous.queue;seen=new Set(previous.seen);}
 else{
  const root=await get(rootId);
  if(!root||!['story','ask','show','job','poll','comment'].includes(root.type))throw Error('Invalid Hacker News thread root');
  queue=(root.kids||[]).map(id=>({id:String(id),depth:1,parentId:observation.id}));
  seen=new Set([rootId]);
 }
 if(queue.length+seen.size>MAX_QUEUED)throw Error('Hacker News thread exceeds checkpoint safety limit');
 const messages=[];
 let processed=0;
 while(queue.length&&processed<maxReplies){
  const current=queue.shift();
  if(seen.has(current.id))continue;
  // Mark only after a successful request, preserving a retryable cursor on failure.
  let item;
  try{item=await get(current.id);}
  catch(error){queue.unshift(current);throw error;}
  seen.add(current.id);
  processed++;
  if(!item||item.deleted||item.dead||item.type!=='comment')continue;
  if(typeof item.text==='string'&&item.text.trim()){
   const body=item.text;
   messages.push({
    id:'hackernews-comment:'+item.id,observationId:observation.id,
    parentId:current.parentId,source:'hackernews',
    authorKey:accountKey('hackernews',item.by??null),
    url:'https://news.ycombinator.com/item?id='+item.id,
    body,publishedAt:item.time?new Date(item.time*1000).toISOString():null,
    contentHash:hashBody(body)
   });
  }
  if(current.depth<maxDepth)for(const kid of item.kids||[]){
   if(!/^\d+$/.test(String(kid)))continue;
   const child=String(kid);
   if(!seen.has(child))queue.push({id:child,depth:current.depth+1,parentId:'hackernews-comment:'+item.id});
  }
  if(queue.length+seen.size>MAX_QUEUED)throw Error('Hacker News thread exceeds checkpoint safety limit');
 }
 return {
  messages,processed,status:queue.length?'partial':'complete',
  cursor:queue.length?{kind:'hackernews',rootId,queue,seen:[...seen]}:null
 };
}
export async function fetchConversationPage(observation,options={}){
 if(observation?.source==='github'||observation?.id?.startsWith('github:'))return fetchGitHubConversationPage(observation,options);
 if(observation?.source==='hackernews'||observation?.id?.startsWith('hackernews:'))return fetchHackerNewsConversationPage(observation,options);
 throw Error('Unsupported conversation root');
}
