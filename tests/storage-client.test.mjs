import test from 'node:test';
import assert from 'node:assert/strict';
import { persistObservations } from '../packages/storage/client.mjs';
const observation={id:'github:42',source:'github',externalId:'42',url:'https://example.org/42',title:'issue',body:'body',publishedAt:null,contentHash:'a'.repeat(64)};
test('commits successful batch',async()=>{const calls=[];const client={query:async (...args)=>{calls.push(args)}};assert.equal(await persistObservations(client,[observation]),1);assert.deepEqual(calls.map(x=>x[0]).filter(x=>typeof x==='string' && !x.startsWith('INSERT')),['BEGIN','COMMIT']);assert.equal(calls.length,3)});
test('rolls back on query failure',async()=>{const calls=[];const client={query:async (sql)=>{calls.push(sql);if(sql.startsWith('INSERT'))throw Error('db down')}};await assert.rejects(persistObservations(client,[observation]),/db down/);assert.equal(calls.at(-1),'ROLLBACK')});
