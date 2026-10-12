import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOpportunity} from '../packages/scoring/opportunity.mjs';
import {clusterProblems,similarity} from '../packages/agents/cluster.mjs';
test('unknown willingness to pay is never invented',()=>{const x=assessOpportunity({factors:{pain:1},evidence:[{source:'github',url:'https://a'},{source:'github',url:'https://a'}]});assert.equal(x.commercialValidation,'unknown');assert.equal(x.evidenceCount,1);assert.equal(x.eligibleForRanking,false);});
test('complete link avoids similarity chaining',()=>{const items=[{statement:'alpha beta gamma delta'},{statement:'alpha beta gamma epsilon'},{statement:'alpha beta epsilon zeta'}];const c=clusterProblems(items,{threshold:0.5});assert.equal(c.length,2);});
test('normalizes simple morphological variants',()=>assert.ok(similarity('CSV parsing crashes on huge files','CSV parsing crash on large file')>0.9));

test('verified evidence is counted separately from claims',()=>{const x=assessOpportunity({evidence:[{source:'github',url:'https://a',excerpt:'literal evidence here',verified:true},{source:'hn',url:'https://b',excerpt:'unsupported claim',verified:false}]});assert.equal(x.verifiedEvidenceCount,1);assert.equal(x.evidenceCount,2);assert.equal(x.eligibleForRanking,false)});
