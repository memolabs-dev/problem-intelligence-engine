import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createPool} from './postgres.mjs';

// Increment this identifier only with an audited, forward-only schema change.
// The baseline is intentionally compatible with previously initialized DBs.
export const SCHEMA_MIGRATION_VERSION='baseline-2026-10-13';
const lockSql='SELECT pg_advisory_xact_lock(18222026,1013)';
const tableSql=`CREATE TABLE IF NOT EXISTS pie_schema_migrations (
 version TEXT PRIMARY KEY,
 checksum CHAR(64) NOT NULL,
 applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;
export function schemaChecksum(ddl){
 if(typeof ddl!=='string'||!ddl.trim())throw Error('Migration requires nonempty schema');
 return createHash('sha256').update(ddl).digest('hex');
}
export async function migrate(pool,{schemaUrl=new URL('./schema.sql',import.meta.url),version=SCHEMA_MIGRATION_VERSION}={}){
 if(typeof version!=='string'||!/^[-a-z0-9]{4,80}$/.test(version))throw Error('Invalid schema migration version');
 const ddl=await readFile(schemaUrl,'utf8'),checksum=schemaChecksum(ddl);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(lockSql);
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  await client.query(tableSql);
  const previous=await client.query('SELECT checksum FROM pie_schema_migrations WHERE version=$1',[version]);
  if(previous.rows.length){
   if(previous.rows[0].checksum.trim()!==checksum)throw Error('Schema checksum mismatch; create a NEW forward-only migration version instead of editing an applied version');
   await client.query('COMMIT');
   return {schema:'schema.sql',version,checksum,applied:false,idempotent:true};
  }
  // Baseline DDL remains idempotent for machines upgraded from early PIE.
  await client.query(ddl);
  await client.query('INSERT INTO pie_schema_migrations(version,checksum) VALUES ($1,$2)',[version,checksum]);
  await client.query('COMMIT');
  return {schema:'schema.sql',version,checksum,applied:true,idempotent:true};
 }catch(error){await client.query('ROLLBACK');throw error;}
 finally{client.release();}
}
if(process.argv[1]?.endsWith('/packages/storage/migrate.mjs')){
 const pool=createPool();
 try{console.log(JSON.stringify(await migrate(pool)));}
 finally{await pool.end();}
}
