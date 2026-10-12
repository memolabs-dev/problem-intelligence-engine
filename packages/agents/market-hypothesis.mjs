import {readFile} from 'node:fs/promises';
import {createPool} from '../storage/postgres.mjs';
import {buildProblemDossier} from './dossier.mjs';

const TYPES=new Set(['alternative','manual_workaround','buyer_statement','price_quote','purchase_claim','distribution_channel']);
const QUESTIONS=[
 'Who personally experiences this problem, and how frequently?',
 'What do people use instead, and how much time or money does it cost?',
 'Who could authorize and pay for a solution?',
 'What independently verifiable evidence demonstrates a purchase or a paid commitment?',
 'Which channel reaches those buyers without assuming source authors are buyers?'
];
export function validateMarketSignals(input,observationId){
 if(input==null)return [];
 if(input.kind!=='market_evidence_input'||input.observationId!==observationId||!Array.isArray(input.entries)||input.entries.length>100)
  throw Error('Market evidence input must match the dossier observation');
 const keys=new Set();
 return input.entries.map((entry,index)=>{
  if(!TYPES.has(entry?.type)||typeof entry.url!=='string'||!/^https:\/\//.test(entry.url)||
    typeof entry.quote!=='string'||entry.quote.trim().length<12||entry.quote.length>800||
    (entry.observedAt!=null&&(!/^\d{4}-\d{2}-\d{2}$/.test(entry.observedAt)||!Number.isFinite(Date.parse(entry.observedAt)))) )
    throw Error('Invalid market evidence entry '+index);
  const k=entry.type+'|'+entry.url+'|'+entry.quote.trim();
  if(keys.has(k))throw Error('Duplicate market evidence entry');
  keys.add(k);
  return {type:entry.type,sourceUrl:entry.url,quotedClaim:entry.quote.trim(),observedAt:entry.observedAt||null,
   evidenceStatus:'supplied_quote_not_independently_verified',
   claimStrength:'unverified',buyerIdentityVerified:false,
   financialTransactionVerified:false};
 });
}
export function assembleMarketHypothesis(dossier,input=null){
 if(!dossier?.observationId||typeof dossier.problem!=='string'||!dossier.evidence?.url?.startsWith('https://'))
  throw Error('A verified current problem dossier is required');
 const signals=validateMarketSignals(input,dossier.observationId);
 const types=new Set(signals.map(s=>s.type));
 return {kind:'commercial_hypothesis_dossier',observationId:dossier.observationId,
  problem:dossier.problem,problemEvidence:dossier.evidence,
  corroboration:{sourceDiscussions:dossier.corroboration?.distinctSourceDiscussions??null,
   independentlyVerifiedPeople:null},
  buyerSegment:'unverified',potentialBuyers:[],alternatives:signals.filter(s=>['alternative','manual_workaround'].includes(s.type)),
  explicitPaymentSignals:signals.filter(s=>['price_quote','purchase_claim'].includes(s.type)),
  distributionSignals:signals.filter(s=>s.type==='distribution_channel'),
  otherSignals:signals.filter(s=>!['alternative','manual_workaround','price_quote','purchase_claim','distribution_channel'].includes(s.type)),
  missingEvidence:{alternativeResearch:!types.has('alternative')&&!types.has('manual_workaround'),
   buyerInterview:!types.has('buyer_statement'),independentlyVerifiedPayment:true,
   independentBuyerValidation:true},
  nextResearchQuestions:QUESTIONS,
  commercialValidation:'unknown',paymentEvidence:'not_verified',
  assessment:'Problem is model-screened; market evidence is supplied but not independently verified. Do not infer buyers, payments or product-market fit.'};
}
export async function buildMarketHypothesis(pool,observationId,{input=null}={}){
 const dossier=await buildProblemDossier(pool,observationId);
 return assembleMarketHypothesis(dossier,input);
}
if(process.argv[1]?.endsWith('/packages/agents/market-hypothesis.mjs')){
 const [id,inputPath]=process.argv.slice(2);
 if(!id)throw Error('Usage: npm run market:hypothesis -- github:<observationId> [/private/evidence.json]');
 const input=inputPath?JSON.parse(await readFile(inputPath,'utf8')):null;
 const pool=createPool();try{console.log(JSON.stringify(await buildMarketHypothesis(pool,id,{input}),null,2));}
 finally{await pool.end();}
}
