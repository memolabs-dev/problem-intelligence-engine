import pg from 'pg';
import { persistObservations } from './client.mjs';

export function createPool({ database = process.env.PGDATABASE || 'problem_intelligence', ...options } = {}) {
  return new pg.Pool({ database, ...options });
}
export async function saveObservations(pool, observations) {
  const client = await pool.connect();
  try { return await persistObservations(client, observations); }
  finally { client.release(); }
}
