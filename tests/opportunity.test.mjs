import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOpportunity} from '../packages/scoring/opportunity.mjs';
import {clusterProblems,similarity} from '../packages/agents/cluster.mjs';
test('unknown willingness to pay is never invented',()=>{const x=assessOpportunity({factors:{pain:1},evidence:[{source:'github',url:'https://a'},{source:'github',url:'https://a'}]});assert.equal(x.commercialValidation,'unknown');assert.equal(x.evidenceCount,1);assert.equal(x.eligibleForRanking,false);});
test('complete link avoids similarity chaining',()=>{const items=[{statement:'alpha beta gamma delta'},{statement:'alpha beta gamma epsilon'},{statement:'alpha beta epsilon zeta'}];const c=clusterProblems(items,{threshold:0.5});assert.equal(c.length,2);});
test('normalizes simple morphological variants',()=>assert.ok(similarity('CSV parsing crashes on huge files','CSV parsing crash on large file')>0.9));

test('verified evidence is counted separately from claims',()=>{const x=assessOpportunity({evidence:[{source:'github',url:'https://a',excerpt:'literal evidence here',verified:true},{source:'hn',url:'https://b',excerpt:'unsupported claim',verified:false}]});assert.equal(x.verifiedEvidenceCount,1);assert.equal(x.evidenceCount,2);assert.equal(x.eligibleForRanking,false)});


test('scoring does not promote a single quoted observation into commercial validation',()=>{
 const x=assessOpportunity({factors:{pain:1,payment:1,buyerAccess:1,competitionGap:1,feasibility:1,advantage:1},evidence:[{source:'github',url:'https://example.org/1',excerpt:'We would like this feature to exist.',verified:true}]});
 assert.equal(x.score,100);
 assert.equal(x.eligibleForRanking,false);
 assert.equal(x.commercialValidation,'unknown');
 assert.equal(x.corroboration,'single_or_no_anchored_observation');
 assert.equal(x.eligibleForExploration,true);
});
test('duplicates cannot inflate verified evidence',()=>{
 const evidence=[{source:'github',url:'https://example.org/1',excerpt:'A recurring problem here',verified:true},{source:'github',url:'https://example.org/1',excerpt:'A recurring problem here',verified:true}];
 const x=assessOpportunity({evidence});
 assert.equal(x.evidenceCount,1);
 assert.equal(x.verifiedEvidenceCount,1);
});
test('well-evidenced, multi-account hypotheses remain subject to human review',()=>{
 const evidence=[
  {source:'github',url:'https://example.org/1',excerpt:'We spend money solving this',verified:true,evidenceType:'payment_intent',reporterKey:'user-one'},
  {source:'hackernews',url:'https://example.org/2',excerpt:'It costs our organization every week',verified:true,reporterKey:'user-two'}
 ];
 const factors={pain:1,payment:0.8,buyerAccess:0.5,competitionGap:0.4,feasibility:0.8,advantage:0.6};
 const x=assessOpportunity({factors,evidence});
 assert.equal(x.eligibleForRanking,true);
 assert.equal(x.explicitPaymentEvidenceCount,1);
 assert.equal(x.distinctReporterAccountCount,2);
 assert.equal(x.commercialValidation,'requires-human-review');
});
