import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySourceProvenance,provenanceRejection} from '../packages/agents/source-provenance.mjs';
import {verifyReport,verifyWithLLM} from '../packages/agents/verify.mjs';
import {auditVerifiedSourceProvenance,CURRENT_POTENTIAL_SECONDARY_SQL} from '../packages/agents/audit-provenance.mjs';

const digest={id:'github:aggregate',title:'📊 AI CLI Tools Digest 2026-08-31',
 body:'A list of 10 tools and their most-liked issue discussions.',url:'https://github.com/example/digests/issues/1'};
const bug={id:'github:direct',title:'Bun TLS requests hang on keep-alive connections',body:'Our requests never complete after ACKed TLS data.',url:'https://github.com/example/bun/issues/2'};
test('distinguishes secondhand news digests from concrete direct issue reports',()=>{
 assert.equal(classifySourceProvenance(digest).kind,'secondary_digest');
 assert.equal(classifySourceProvenance({title:'Weekly roundup of project issues'}).kind,'secondary_digest');
 assert.equal(classifySourceProvenance(bug).kind,'unassessed_primary_or_other');
 assert.equal(classifySourceProvenance({title:'Crypto hash digest calculation crashes on Windows'}).kind,'unassessed_primary_or_other');
 assert.equal(provenanceRejection(bug),null);
 assert.equal(provenanceRejection(digest).category,'unsupported');
});
test('verification gate prevents aggregate digest from being counted even if judge would approve',async()=>{
 let judgeCalls=0;
 const pool={query:async()=>({rows:[digest]})};
 const report={results:[{observationId:digest.id,status:'found',candidate:{
  observationId:digest.id,sourceUrl:digest.url,statement:'Some user cannot track spend reliably',excerpt:digest.body
 }}]};
 const result=await verifyReport(pool,report,{judge:async()=>{judgeCalls++;return {accept:true,category:'observed_failure'};}});
 assert.equal(judgeCalls,0);
 assert.equal(result.found,0);
 assert.equal(result.rejected,1);
 assert.equal(result.results[0].verification.sourceRole,'secondary_digest');
});
test('standalone model verifier rejects a digest before any network request',async()=>{
 let calls=0;
 const result=await verifyWithLLM(digest,{statement:'An observed problem in another issue',excerpt:digest.body},{
  env:{PIE_LLM_PROVIDER:'openrouter',PIE_LLM_MODEL:'nvidia/nemotron-3.5-lightning:free',OPENROUTER_API_KEY:'mock'},
  fetcher:async()=>{calls++;throw Error('unexpected network call');}
 });
 assert.equal(calls,0);assert.equal(result.accept,false);
 assert.equal(result.method,'deterministic-source-provenance');
});
test('retroactive audit uses append-only rejected decision rather than deleting older findings',async()=>{
 const contentHash='a'.repeat(64);
 const pool={query:async(sql)=>{
  assert.equal(sql,CURRENT_POTENTIAL_SECONDARY_SQL);
  return {rows:[{...digest,content_hash:contentHash},{...bug,content_hash:contentHash}]};
 }};
 let passed;
 const correction=await auditVerifiedSourceProvenance(pool,{persist:async(_db,report,opts)=>{
  passed={report,opts};return {inserted:true,runId:'audit-run'};
 }});
 assert.equal(correction.secondarySummaries,1);
 assert.equal(correction.archivedCorrection,true);
 assert.equal(passed.opts.provider,'internal');
 assert.equal(passed.report.results[0].status,'rejected');
 assert.equal(passed.report.results[0].sourceContentHash,contentHash);
});
test('dry-run quality audit never writes anything',async()=>{
 const pool={query:async()=>({rows:[{...digest,content_hash:'a'.repeat(64)}]})};
 const result=await auditVerifiedSourceProvenance(pool,{dryRun:true,persist:async()=>{throw Error('unexpected write');}});
 assert.equal(result.dryRun,true);
 assert.equal(result.archivedCorrection,false);
});
