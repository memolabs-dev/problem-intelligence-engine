import {createHash} from 'node:crypto';
import {accountKey} from './identity.mjs';

function hashBody(text){return createHash('sha256').update(text).digest('hex');}
function checkLimit(limit,maximum){if(!Number.isInteger(limit)||limit<0||limit>maximum)throw new RangeError('Invalid conversation fetch limit');}
function parseGithubIssue(url){
 const parsed=/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)(?:[/?#]|$)/.exec(String(url||''));
 if(!parsed)throw new Error('Expected GitHub issue URL');
 return {owner:parsed[1],repo:parsed[2],number:parsed[3]};
}
export async function fetchGithubConversation(observation,{fetcher=fetch,token,maxReplies=30}={}){
 checkLimit(maxReplies,100);
 if(!observation?.id?.startsWith('github:'))throw new Error('Expected GitHub observation');
 const {owner,repo,number}=parseGithubIssue(observation.url);
 if(maxReplies===0)return [];
 const headers={Accept:'application/vnd.github+json','User-Agent':'problem-intelligence-engine'};
 if(token)headers.Authorization='Bearer '+token;
 const endpoint=`https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments?per_page=${maxReplies}&page=1`;
 const response=await fetcher(endpoint,{headers});
 if(!response.ok)throw new Error('GitHub conversation HTTP '+response.status);
 const comments=await response.json();
 if(!Array.isArray(comments))throw new Error('Invalid GitHub comment response');
 return comments.slice(0,maxReplies).filter(c=>c?.id&&typeof c.body==='string'&&c.body.trim()).map(c=>{
  const body=c.body;
  return {
   id:'github-comment:'+c.id,observationId:observation.id,parentId:observation.id,source:'github',
   authorKey:accountKey('github',c.user?.id??null),
   url:c.html_url||observation.url+'#issuecomment-'+c.id,
   body,publishedAt:c.created_at||null,contentHash:hashBody(body)
  };
 });
}
export async function fetchHackerNewsConversation(observation,{fetcher=fetch,maxReplies=30,maxDepth=4}={}){
 checkLimit(maxReplies,100);
 if(!observation?.id?.startsWith('hackernews:'))throw new Error('Expected HN observation');
 if(!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>10)throw RangeError('Invalid thread depth');
 if(maxReplies===0)return [];
 const rootId=observation.id.slice('hackernews:'.length);
 const get=async id=>{
  const response=await fetcher(`https://hacker-news.firebaseio.com/v0/item/${encodeURIComponent(id)}.json`);
  if(!response.ok)throw new Error('Hacker News conversation HTTP '+response.status);
  return response.json();
 };
 const root=await get(rootId);
 const queue=(root?.kids||[]).map(id=>({id,depth:1,parentId:observation.id}));
 const visited=new Set([String(rootId)]);
 const replies=[];
 while(queue.length&&replies.length<maxReplies){
  const current=queue.shift();
  if(visited.has(String(current.id)))continue;
  visited.add(String(current.id));
  const item=await get(current.id);
  if(!item||item.deleted||item.dead||item.type!=='comment')continue;
  if(typeof item.text==='string'&&item.text.trim()){
   replies.push({
    id:'hackernews-comment:'+item.id,observationId:observation.id,parentId:current.parentId,source:'hackernews',
    authorKey:accountKey('hackernews',item.by??null),
    url:'https://news.ycombinator.com/item?id='+item.id,
    body:item.text,publishedAt:item.time?new Date(item.time*1000).toISOString():null,
    contentHash:hashBody(item.text)
   });
  }
  if(current.depth<maxDepth)for(const id of item.kids||[])queue.push({id,depth:current.depth+1,parentId:'hackernews-comment:'+item.id});
 }
 return replies;
}
export async function fetchConversation(observation,options={}){
 if(observation?.source==='github'||observation?.id?.startsWith('github:'))return fetchGithubConversation(observation,options);
 if(observation?.source==='hackernews'||observation?.id?.startsWith('hackernews:'))return fetchHackerNewsConversation(observation,options);
 throw Error('Unsupported conversation source');
}
