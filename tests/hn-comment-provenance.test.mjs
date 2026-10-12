import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHackerNewsSearchComment} from '../packages/connectors/hackernews.mjs';
import {searchPublicHackerNewsComments,runTargetedDiscovery,isRelevantPublicComment} from '../packages/ingestion/targeted.mjs';
import {observationParams,UPSERT_OBSERVATION} from '../packages/storage/observations.mjs';
import {buildEvidenceGraph} from '../packages/agents/evidence-graph.mjs';
import {compileCorroborationGroups} from '../packages/agents/corroborate.mjs';
import {assembleDossier} from '../packages/agents/dossier.mjs';
import {HOLDOUT_PAIR_POOL_SQL} from '../packages/agents/holdout.mjs';

const hn=(id,author,storyId=777)=>({
 objectID:String(id),story_id:storyId,author,created_at_i:1750000000,
 comment_text:'Our software fails to unref web workers when the event loop should exit.'
});
test('Algolia comments preserve exact source quotes, thread root and pseudonymous account',()=>{
 const a=normalizeHackerNewsSearchComment(hn(101,'alice'));
 const b=normalizeHackerNewsSearchComment(hn(102,'bob'));
 assert.equal(a.id,'hackernews:101');assert.equal(b.id,'hackernews:102');
 assert.equal(a.threadRootId,'hackernews:777');
 assert.equal(a.threadRootId,b.threadRootId);
 assert.notEqual(a.reporterKey,b.reporterKey);
 assert.equal(a.body,hn(101,'alice').comment_text);
 assert.equal(a.title,'');
 assert.equal(normalizeHackerNewsSearchComment({...hn(99,'alice'),story_id:null}),null);
 assert.equal(normalizeHackerNewsSearchComment({...hn(99,'alice'),comment_text:''}),null);
});
test('recent HN comment search is bounded and retains original public story reference',async()=>{
 let url;
 const hits=await searchPublicHackerNewsComments('unref worker',{limit:3,nowUnix:1760000000,lookbackDays:365,
  fetcher:async link=>{url=link;return {ok:true,json:async()=>({hits:[hn(101,'alice'),hn(102,'bob')]})};}});
 const parsed=new URL(url);
 assert.equal(parsed.pathname,'/api/v1/search_by_date');
 assert.equal(parsed.searchParams.get('tags'),'comment');
 assert.match(parsed.searchParams.get('numericFilters'),/created_at_i>\d+/);
 assert.equal(hits.length,2);
 assert.equal(hits[0].threadRootId,hits[1].threadRootId);
 await assert.rejects(searchPublicHackerNewsComments('unref worker',{lookbackDays:5000}),/Invalid HN comment search window/);
});
test('mixed HN discovery counts two comment authors but one independent discussion',async()=>{
 const fetcher=async link=>{
  if(link.includes('api.github.com'))return {ok:true,json:async()=>({items:[]})};
  if(link.includes('search_by_date'))return {ok:true,json:async()=>({hits:[hn(101,'alice'),hn(102,'bob')]})};
  return {ok:true,json:async()=>({hits:[]})};
 };
 let saved;
 const report=await runTargetedDiscovery(null,'unref worker',{includeHNComments:true,fetcher,
  persist:async(_pool,observations)=>{saved=observations;}});
 assert.equal(report.uniqueObservations,2);
 assert.equal(report.distinctSourceAccounts,2);
 assert.equal(report.distinctSourceThreads,1);
 assert.equal(report.hackerNewsCommentObservations,2);
 assert.deepEqual(report.observationThreadRoots,{'hackernews:101':'hackernews:777','hackernews:102':'hackernews:777'});
 assert.equal(saved[0].threadRootId,'hackernews:777');
 assert.ok(report.sources.some(item=>item.source==='hackernews_comments'&&item.status==='ok'));
});
test('third provider failure is visible without losing GitHub and story results',async()=>{
 const fetcher=async link=>{
  if(link.includes('search_by_date'))return {ok:false,status:429};
  if(link.includes('api.github.com'))return {ok:true,json:async()=>({items:[]})};
  return {ok:true,json:async()=>({hits:[]})};
 };
 const result=await runTargetedDiscovery(null,'unref worker',{fetcher,includeHNComments:true,persist:async()=>{}});
 assert.equal(result.incomplete,true);
 assert.equal(result.sources[2].status,'error');
});
test('storage params include the original thread ID rather than count every reply as a new source',()=>{
 const row=normalizeHackerNewsSearchComment(hn(101,'alice'));
 assert.equal(observationParams(row)[9],'hackernews:777');
 assert.match(UPSERT_OBSERVATION,/thread_root_id/);
});
test('evidence graph treats two corroborating comments within one story as one discussion',()=>{
 const a=normalizeHackerNewsSearchComment(hn(101,'alice'));
 const b=normalizeHackerNewsSearchComment({...hn(102,'bob'),comment_text:'Web workers never release our event loop after processing.'});
 const extract=row=>({observationId:row.id,status:'found',
  candidate:{statement:'Web workers keep running after processing finishes',excerpt:row.body,sourceUrl:row.url},
  verification:{accept:true,category:'observed_failure'}});
 const graph=buildEvidenceGraph({results:[extract(a),extract(b)]},[a,b]);
 assert.equal(graph.validCandidates,2);
 assert.equal(graph.clusterCount,1);
 assert.equal(graph.problems[0].observationCount,2);
 assert.equal(graph.problems[0].distinctDiscussionCount,1);
 assert.equal(graph.problems[0].corroboration,'multiple_observations_single_discussion');
});
test('semantic grouping and dossiers never treat repeated replies as separate discussions',()=>{
 const a={id:'hackernews:101',runId:'x',statement:'Worker never exits',source:'hackernews',url:'https://news.ycombinator.com/item?id=101',accountKey:'alice',threadRootId:'hackernews:777'};
 const b={id:'hackernews:102',runId:'x',statement:'Worker keeps process alive',source:'hackernews',url:'https://news.ycombinator.com/item?id=102',accountKey:'bob',threadRootId:'hackernews:777'};
 const pair={left_id:a.id,right_id:b.id,left_run:'x',right_run:'x',left_statement:a.statement,right_statement:b.statement,left_source:'hackernews',right_source:'hackernews',left_url:a.url,right_url:b.url};
 const group=compileCorroborationGroups([pair],[{left_id:a.id,right_id:b.id,verdict:'same_problem'}],[a,b])[0];
 assert.equal(group.distinctDiscussionCount,1);
 assert.equal(group.corroboration,'multiple_observations_single_discussion');
 const dossier=assembleDossier({run_id:'x',observation_id:a.id,statement:a.statement,excerpt:'Workers never exit',url:a.url,reporter_key:'alice',thread_root_id:'hackernews:777'},[
  {id:b.id,statement:b.statement,excerpt:'Process stays alive',url:b.url,reporter_key:'bob',thread_root_id:'hackernews:777'}
 ],[]);
 assert.equal(dossier.corroboration.distinctSourceDiscussions,1);
 assert.equal(dossier.corroboration.distinctKnownSourceAccounts,2);
});
test('blind benchmark excludes pairs from the same HN discussion',()=>{
 assert.match(HOLDOUT_PAIR_POOL_SQL,/COALESCE\(a\.thread_root_id,a\.id\)<>COALESCE\(b\.thread_root_id,b\.id\)/);
});

test('HN comment search rejects recency-ranked off-topic hits before LLM extraction',()=>{
 assert.equal(isRelevantPublicComment('Web workers stay alive indefinitely after tasks finish','web workers'),true);
 assert.equal(isRelevantPublicComment('A contemporary post about the web and modern art','web workers'),false);
 assert.equal(isRelevantPublicComment('My worker cannot be unreffed after sending response','worker unreffed'),true);
 assert.equal(isRelevantPublicComment('Unrelated discussion about cryptocurrency inflation','web workers'),false);
});
