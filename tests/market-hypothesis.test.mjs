import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleMarketHypothesis,validateMarketSignals} from '../packages/agents/market-hypothesis.mjs';
const dossier={observationId:'github:1',problem:'The bundler breaks named chunk imports',
 evidence:{url:'https://github.com/a/b/issues/1',excerpt:'Named dynamic chunks are not honored'},
 corroboration:{distinctSourceDiscussions:2}};
const input={kind:'market_evidence_input',observationId:'github:1',entries:[
 {type:'alternative',url:'https://example.org/alternatives',quote:'People currently use a manual workaround with maintenance overhead.',observedAt:'2026-10-13'},
 {type:'purchase_claim',url:'https://example.org/claim',quote:'One forum author says their team bought a replacement.'}
]};
test('commercial hypothesis remains unknown without independent buyer proof',()=>{
 const result=assembleMarketHypothesis(dossier,input);
 assert.equal(result.commercialValidation,'unknown');
 assert.equal(result.paymentEvidence,'not_verified');
 assert.equal(result.buyerSegment,'unverified');
 assert.equal(result.explicitPaymentSignals[0].financialTransactionVerified,false);
 assert.equal(result.explicitPaymentSignals[0].claimStrength,'unverified');
 assert.equal(result.corroboration.independentlyVerifiedPeople,null);
});
test('unknown commercial signals remain unknown rather than false or absent demand',()=>{
 const result=assembleMarketHypothesis(dossier);
 assert.equal(result.alternatives.length,0);
 assert.equal(result.missingEvidence.alternativeResearch,true);
 assert.equal(result.missingEvidence.independentlyVerifiedPayment,true);
 assert.ok(result.nextResearchQuestions.length>=3);
});
test('explicit citations, matching problem ID and duplicate checks are required',()=>{
 assert.throws(()=>validateMarketSignals({...input,observationId:'github:2'},'github:1'),/match/);
 assert.throws(()=>validateMarketSignals({...input,entries:[{type:'purchase_claim',url:'http://example.com',quote:'Paid for access many times'}]},'github:1'),/Invalid/);
 assert.throws(()=>validateMarketSignals({...input,entries:[input.entries[0],input.entries[0]]},'github:1'),/Duplicate/);
 assert.throws(()=>validateMarketSignals({...input,entries:[{...input.entries[0],quote:'Too short'}]},'github:1'),/Invalid/);
});
test('valid manual price quotes do not establish paid revenue or verified buyer identities',()=>{
 const result=assembleMarketHypothesis(dossier,{...input,entries:[{type:'price_quote',url:'https://example.org/pricing',quote:'The listed plan costs twelve dollars per month.'}]});
 assert.equal(result.explicitPaymentSignals.length,1);
 assert.equal(result.explicitPaymentSignals[0].buyerIdentityVerified,false);
 assert.equal(result.missingEvidence.independentlyVerifiedPayment,true);
});
