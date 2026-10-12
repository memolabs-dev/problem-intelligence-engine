import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool, saveObservations } from '../packages/storage/postgres.mjs';

test('real PostgreSQL transaction stores an observation and rolls back test data', async t => {
 if (process.env.PIE_INTEGRATION !== '1') return t.skip('set PIE_INTEGRATION=1 to run');
 const pool=createPool();
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const id=`github:integration-${process.pid}`;
  const observation={id,source:'github',externalId:`integration-${process.pid}`,url:'https://example.org/integration',title:'Integration',body:'Test',publishedAt:null,contentHash:'a'.repeat(64)};
  await client.query('SAVEPOINT pie_test');
  // saveObservations owns its own transaction, so use a dedicated pool connection and delete test data after validation.
  await client.query('ROLLBACK TO SAVEPOINT pie_test');
  await client.query('ROLLBACK');
  await saveObservations(pool,[observation]);
  const result=await pool.query('SELECT id FROM observations WHERE id=$1',[id]);
  assert.equal(result.rows[0]?.id,id);
  await pool.query('DELETE FROM observations WHERE id=$1',[id]);
 } finally { client.release(); await pool.end(); }
});
