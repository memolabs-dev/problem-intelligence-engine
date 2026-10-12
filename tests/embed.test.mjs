import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEmbedding,embedText,storeEmbeddings,EMBEDDING_DIMENSIONS} from '../packages/agents/embed.mjs';
test('embedding rejects wrong dimensions and malformed values',()=>{
 assert.throws(()=>validateEmbedding([1,2]),/Invalid embedding/);
 assert.throws(()=>validateEmbedding(Array(384).fill(NaN)),/Invalid embedding/);
 assert.throws(()=>validateEmbedding(Array(384).fill(0)),/Zero-norm/);
});
test('embedding is validated without using a remote provider',async()=>{
 const vector=Array(EMBEDDING_DIMENSIONS).fill(0.01);
 const result=await embedText('Evidence-backed concrete issue',{fetcher:async(url,options)=>{
  assert.match(url,/^http:\/\/127\.0\.0\.1:11434\/api\/embed$/);
  assert.equal(JSON.parse(options.body).model,'all-minilm');
  return {ok:true,json:async()=>({embeddings:[vector]})};
 }});
 assert.equal(result.length,384);
 await assert.rejects(embedText('foo',{endpoint:'https://external.example/api/embed'}),/local Ollama/);
});
test('stored embeddings skip statements with the same hash',async()=>{
 const input={run_id:'run-x',observation_id:'github:1',statement:'CSV parsing fails for very large input files'};
 let hash=null;let inserts=0;
 const pool={query:async(sql,args)=>{
  if(sql.includes('FROM ranked JOIN observations'))return {rows:[input]};
  if(sql.startsWith('SELECT statement_hash'))return {rows:hash?[{statement_hash:hash}]:[]};
  if(sql.startsWith('INSERT INTO problem_embeddings')){inserts++;hash=args[3];return {rowCount:1};}
  throw Error('unexpected SQL '+sql.slice(0,50));
 }};
 const embed=async()=>Array(384).fill(0.05);
 const first=await storeEmbeddings(pool,{embed});const second=await storeEmbeddings(pool,{embed});
 assert.equal(first.inserted,1);assert.equal(second.unchanged,1);assert.equal(inserts,1);
});
