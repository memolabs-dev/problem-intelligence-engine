import test from 'node:test';
import assert from 'node:assert/strict';
import {migrate,schemaChecksum,SCHEMA_MIGRATION_VERSION} from '../packages/storage/migrate.mjs';
import {createPool} from '../packages/storage/postgres.mjs';

test('baseline has a stable identifier and checksum protects schema changes',()=>{
 assert.equal(SCHEMA_MIGRATION_VERSION,'baseline-2026-10-13');
 assert.match(schemaChecksum('CREATE TABLE a()'),/^[0-9a-f]{64}$/);
 assert.notEqual(schemaChecksum('CREATE TABLE a()'),schemaChecksum('CREATE TABLE b()'));
 assert.throws(()=>schemaChecksum(''),/nonempty/);
});
test('migration starts transaction, locks, records hash, and returns idempotent on re-run',async()=>{
 const executed=[];let applied=false;
 const client={release(){executed.push('release');},query:async(sql,args)=>{
  executed.push(sql);
  if(sql.startsWith('SELECT checksum FROM pie_schema_migrations'))return {rows:applied?[{checksum:recorded}]:[]};
  if(sql.startsWith('INSERT INTO pie_schema_migrations')){recorded=args[1];applied=true;}
  return {rows:[]};
 }};
 let recorded;
 const pool={connect:async()=>client};
 const first=await migrate(pool);
 assert.equal(first.applied,true);
 assert.ok(executed.includes('COMMIT'));
 assert.ok(executed.some(s=>s.includes('pg_advisory_xact_lock')));
 const second=await migrate(pool);
 assert.equal(second.applied,false);
 assert.equal(first.checksum,second.checksum);
 assert.equal(executed.filter(x=>x==='release').length,2);
});
test('checksum conflict triggers rollback rather than reapplying modified schema',async()=>{
 const commands=[];
 const client={release(){},query:async(sql)=>{
  commands.push(sql);
  if(sql.startsWith('SELECT checksum FROM pie_schema_migrations'))return {rows:[{checksum:'0'.repeat(64)}]};
  return {rows:[]};
 }};
 await assert.rejects(migrate({connect:async()=>client}),/checksum mismatch/);
 assert.equal(commands.at(-1),'ROLLBACK');
 assert.ok(!commands.some(s=>s.startsWith('INSERT INTO pie_schema_migrations')));
});
test('real PostgreSQL migration is idempotent',async t=>{
 if(process.env.PIE_INTEGRATION!=='1')return t.skip('PIE_INTEGRATION=1 required');
 const pool=createPool();try{
  const first=await migrate(pool);const second=await migrate(pool);
  assert.equal(second.applied,false);
  assert.equal(first.checksum,second.checksum);
  const {rows}=await pool.query('SELECT checksum FROM pie_schema_migrations WHERE version=$1',[SCHEMA_MIGRATION_VERSION]);
  assert.equal(rows[0].checksum.trim(),first.checksum);
 }finally{await pool.end();}
});
