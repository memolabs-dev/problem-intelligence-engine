import {readFile,writeFile} from 'node:fs/promises';
import {createPool} from '../storage/postgres.mjs';
import {buildStoredEvidenceGraph} from './evidence-graph.mjs';

/**
 * Rebuild the evidence graph from an existing verified batch without paying
 * for another model run. The source is always reread from PostgreSQL.
 */
export async function graphExistingReport(pool,report,options={}){
 return buildStoredEvidenceGraph(pool,report,options);
}
if(process.argv[1]?.endsWith('/packages/agents/graph-report.mjs')){
 const input=process.argv[2];
 if(!input)throw Error('Usage: node packages/agents/graph-report.mjs <verified-report.json> [output.json]');
 const report=JSON.parse(await readFile(input,'utf8'));
 const pool=createPool();
 try{
  const graph=await graphExistingReport(pool,report);
  const output=process.argv[3];
  if(output)await writeFile(output,JSON.stringify(graph,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({verifiedCandidates:graph.status.found,usableCandidates:graph.validCandidates,invalidCandidates:graph.invalidCandidates.length,clusters:graph.clusterCount,singleObservation:graph.problems.filter(x=>x.corroboration==='single_observation').length,multipleObservations:graph.problems.filter(x=>x.observationCount>1).length,output:output||null},null,2));
 }finally{await pool.end();}
}
