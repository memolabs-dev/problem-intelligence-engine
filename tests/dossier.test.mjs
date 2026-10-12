import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleDossier,buildProblemDossier,CURRENT_DOSSIER_ROOT_SQL,VERIFIED_RELATED_DOSSIER_SQL,VERIFIED_DOSSIER_THREAD_SQL} from '../packages/agents/dossier.mjs';

const root={
 run_id:'test-run',observation_id:'github:1',statement:'Dynamic imports lose named chunks after migration',
 excerpt:'Turbopack ignores webpackChunkName in dynamic imports',
 qualification:'observed_failure',title:'Missing named chunks',source:'github',
 url:'https://github.com/next/example/issues/1',reporter_key:'account-a'
};
const other={
 id:'github:2',statement:'Named chunks are lost under the new bundler',
 excerpt:'Next.js migration no longer respects webpackChunkName',
 source:'github',url:'https://github.com/next/example/issues/2',reporter_key:'account-a',
 rationale:'Same underlying bundler behavior'
};
test('dossier distinguishes same-account repeated posts from independently verified people',()=>{
 const report=assembleDossier(root,[other,other],[
  {author_key:'account-b',verdict:'agreement_only',excerpt:'Same here, exactly this problem.'},
  {author_key:'account-b',verdict:'agreement_only',excerpt:'Same here, exactly this problem.'},
  {author_key:'account-a',verdict:'firsthand_same_problem',excerpt:'I still cannot name chunks'}
 ]);
 assert.equal(report.corroboration.sameProblemObservations,2);
 assert.equal(report.corroboration.distinctKnownSourceAccounts,1);
 assert.equal(report.corroboration.duplicatePostsByRootAccount,1);
 assert.equal(report.corroboration.independentlyVerifiedPeople,null);
 assert.equal(report.discussion.agreementOnlyAccounts,1);
 assert.equal(report.discussion.reportedFirsthandAccounts,0);
 assert.equal(report.discussion.independentSourceThreadsAdded,0);
 assert.equal(report.commercialValidation,'unknown');
 assert.equal(report.paymentEvidence,'not_assessed');
 assert.equal(JSON.stringify(report).includes('account-a'),false);
});
test('dossier separates multiple source accounts from independently verified humans',()=>{
 const differing={...other,id:'github:3',reporter_key:'account-b'};
 const report=assembleDossier(root,[differing],[]);
 assert.equal(report.corroboration.distinctKnownSourceAccounts,2);
 assert.equal(report.corroboration.reports[0].sameSourceAccountAsRoot,false);
 assert.equal(report.corroboration.independentlyVerifiedPeople,null);
});
test('unknown author identity does not become a known independent account',()=>{
 const report=assembleDossier(root,[{...other,reporter_key:null}],[]);
 assert.equal(report.corroboration.distinctKnownSourceAccounts,null);
 assert.equal(report.corroboration.reports[0].sameSourceAccountAsRoot,null);
});
test('dossier loads only latest source-grounded evidence and its matching semantic policy',async()=>{
 const queries=[];
 const pool={query:async(sql,args)=>{
  queries.push({sql,args});
  if(sql===CURRENT_DOSSIER_ROOT_SQL)return {rows:[root]};
  if(sql===VERIFIED_RELATED_DOSSIER_SQL)return {rows:[other]};
  if(sql===VERIFIED_DOSSIER_THREAD_SQL)return {rows:[]};
  throw Error('Unexpected query');
 }};
 const r=await buildProblemDossier(pool,'github:1');
 assert.equal(r.corroboration.sameProblemObservations,2);
 assert.deepEqual(queries[0].args,['github:1']);
 assert.match(queries[1].args[2],/same-problem-v2$/);
 assert.match(queries[1].sql,/linked\.source_content_hash=o\.content_hash/);
 assert.match(queries[2].sql,/position\(s\.excerpt in m\.body\)>0/);
});
test('missing or unverified source cannot produce a dossier',async()=>{
 await assert.rejects(buildProblemDossier({query:async()=>({rows:[]})},'github:99'),/No current verified/);
 await assert.rejects(buildProblemDossier({},'bad id'),/Invalid source observation ID/);
});
