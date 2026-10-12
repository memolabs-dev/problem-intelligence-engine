import { observationParams, UPSERT_OBSERVATION } from './observations.mjs';

export async function persistObservations(client, observations) {
  if (!Array.isArray(observations)) throw new TypeError('observations must be an array');
  await client.query('BEGIN');
  try {
    for (const observation of observations) {
      await client.query(UPSERT_OBSERVATION, observationParams(observation));
    }
    await client.query('COMMIT');
    return observations.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
