import {createHash} from 'node:crypto';
import {createPool} from './postgres.mjs';

const PIPELINE_VERSION='extract-tool-v2+verify-tool-v2+source-snapshot-v3';
export function stableRunId(report,provider,model,sourceHashes={}){
 if(!Array.isArray(report?.results))throw new Error('Invalid verified report');
 const results=[...report.results].map(r=>({
  id:r.observationId,status:r.status,sourceHash:sourceHashes[r.observationId]??r.sourceContentHash??null,statement:r.candidate?.statement||null,excerpt:r.candidate?.excerpt||null,
  qualification:r.verification?.category||null,method:r.candidate?.method||r.extractionMethod||null,recovery:r.recovery?.kind||null
 })).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const h=createHash('sha256').update(JSON.stringify({provider,model,version:PIPELINE_VERSION,results})).digest('hex');
 // RFC 4122-compliant v5-like stable identifier, without external UUID dependencies.
 return [h.slice(0,8),h.slice(8,12),'5'+h.slice(13,16),'a'+h.slice(17,20),h.slice(20,32)].join('-');
}
function validateResult(item,row){
 if(!row)throw new Error('Observation missing: '+item.observationId);
 if(!['found','rejected','none','error'].includes(item.status))throw new Error('Invalid model result status');
 if(item.sourceContentHash && item.sourceContentHash!==row.content_hash?.trim())throw new Error('Source changed since model extraction');
 if(item.status!=='found')return;
 const c=item.candidate;
 if(item.verification?.accept!==true||!c||typeof c.statement!=='string'||c.statement.length<12||typeof c.excerpt!=='string'||c.excerpt.length<12)throw new Error('Invalid verified candidate');
 if(c.observationId!==item.observationId||c.sourceUrl!==row.url||!String(row.title||'').concat('\n',String(row.body||'')).includes(c.excerpt))throw new Error('Stored evidence is no longer source-grounded');
}
export async function persistVerifiedRun(pool,report,{provider,model}={}){
 if(!provider||!model||!Array.isArray(report?.results))throw new Error('Provider, model and verified results required');
 const ids=report.results.map(r=>r.observationId);
 if(new Set(ids).size!==ids.length)throw new Error('Duplicate observation in model run');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const {rows}=await client.query('SELECT id,title,body,url,content_hash FROM observations WHERE id=ANY($1::text[])',[ids]);
  const sourceById=new Map(rows.map(row=>[row.id,row]));
  for(const item of report.results)validateResult(item,sourceById.get(item.observationId));
  const sourceHashes=Object.fromEntries(rows.map(row=>[row.id,row.content_hash?.trim()]));
  const runId=stableRunId(report,provider,model,sourceHashes);
  const inserted=await client.query(
   'INSERT INTO model_runs(id,provider,model,pipeline_version,total_observations) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id',
   [runId,provider,model,PIPELINE_VERSION,report.results.length]
  );
  if(inserted.rowCount){
   for(const item of report.results){
    const row=sourceById.get(item.observationId);
    await client.query(
     'INSERT INTO model_decisions(run_id,observation_id,source_content_hash,status,statement,excerpt,qualification,elapsed_ms,extraction_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
     [runId,item.observationId,row.content_hash,item.status,item.status==='found'?item.candidate.statement:null,item.status==='found'?item.candidate.excerpt:null,item.verification?.category||null,Number.isInteger(item.elapsedMs)&&item.elapsedMs>=0?item.elapsedMs:null,item.candidate?.method||item.extractionMethod||null]
    );
   }
  }
  await client.query('COMMIT');
  return {runId,inserted:inserted.rowCount>0,decisions:inserted.rowCount?report.results.length:0,model};
 }catch(error){await client.query('ROLLBACK');throw error;}
 finally{client.release();}
}
if(process.argv[1]?.endsWith('/packages/storage/model-runs.mjs')){
 const input=process.argv[2];const provider=process.argv[3]||'openrouter';const model=process.argv[4]||'nvidia/nemotron-3.5-lightning:free';
 if(!input)throw Error('Usage: node packages/storage/model-runs.mjs <verified-report.json> [provider] [model]');
 const {readFile}=await import('node:fs/promises');
 const report=JSON.parse(await readFile(input,'utf8'));
 const pool=createPool();
 try{console.log(JSON.stringify(await persistVerifiedRun(pool,report,{provider,model})));}
 finally{await pool.end();}
}
