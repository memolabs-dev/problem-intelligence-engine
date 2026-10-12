import {createPool} from '../storage/postgres.mjs';
import {classifySourceProvenance,PROVENANCE_POLICY_VERSION,provenanceRejection} from './source-provenance.mjs';
import {persistVerifiedRun} from '../storage/model-runs.mjs';

export const CURRENT_POTENTIAL_SECONDARY_SQL=`
WITH ranked AS (
 SELECT d.observation_id,d.status,d.source_content_hash,
  row_number() OVER (PARTITION BY d.observation_id ORDER BY r.started_at DESC,r.id DESC) AS rn
 FROM model_decisions d JOIN model_runs r ON r.id=d.run_id
)
SELECT o.id,o.title,o.content_hash,o.url
FROM ranked latest JOIN observations o ON o.id=latest.observation_id
WHERE latest.rn=1 AND latest.status='found'
 AND latest.source_content_hash=o.content_hash
ORDER BY o.id`;

export async function auditVerifiedSourceProvenance(pool,{dryRun=false,persist=persistVerifiedRun}={}){
 const {rows}=await pool.query(CURRENT_POTENTIAL_SECONDARY_SQL);
 const suspect=rows.filter(o=>classifySourceProvenance(o).kind==='secondary_digest');
 const result={policy:PROVENANCE_POLICY_VERSION,reviewedCurrentVerified:rows.length,
  secondarySummaries:suspect.length,ids:suspect.map(r=>r.id),
  archivedCorrection:false,dryRun};
 if(!suspect.length||dryRun)return result;
 const report={
  results:suspect.map(o=>({
   observationId:o.id,status:'rejected',sourceContentHash:o.content_hash?.trim(),
   verification:provenanceRejection(o)
  }))
 };
 const archived=await persist(pool,report,{provider:'internal',model:PROVENANCE_POLICY_VERSION});
 return {...result,archivedCorrection:archived.inserted,correctionRunId:archived.runId};
}
if(process.argv[1]?.endsWith('/packages/agents/audit-provenance.mjs')){
 const pool=createPool();
 try{console.log(JSON.stringify(await auditVerifiedSourceProvenance(pool,{dryRun:process.env.PIE_PROVENANCE_DRY_RUN==='1'}),null,2));}
 finally{await pool.end();}
}
