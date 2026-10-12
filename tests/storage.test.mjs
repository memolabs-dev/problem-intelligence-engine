import test from 'node:test';
import assert from 'node:assert/strict';
import {UPSERT_OBSERVATION,observationParams} from '../packages/storage/observations.mjs';
test('upsert is idempotent by identity',()=>assert.match(UPSERT_OBSERVATION,/ON CONFLICT \(id\)/));
test('no write for unchanged observation',()=>assert.match(UPSERT_OBSERVATION,/IS DISTINCT FROM/));
test('params keep evidence identity',()=>assert.deepEqual(observationParams({id:'github:1',source:'github',externalId:'1',url:'https://example.org',title:'t',body:'b',publishedAt:null,contentHash:'hash'}).slice(0,3),['github:1','github','1']));
