import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForFreeModelSlot,resetRateLimiterForTests} from '../packages/agents/rate-limit.mjs';
test('process-local limiter spaces requests while remaining testable without waiting',async()=>{
 resetRateLimiterForTests();
 const delays=[];
 await waitForFreeModelSlot({intervalMs:3300,now:()=>1000,sleeper:async ms=>delays.push(ms)});
 await waitForFreeModelSlot({intervalMs:3300,now:()=>1000,sleeper:async ms=>delays.push(ms)});
 assert.deepEqual(delays,[3300]);
 resetRateLimiterForTests();
});
test('rejects invalid rate limit settings',async()=>{
 await assert.rejects(waitForFreeModelSlot({intervalMs:-1}),/Invalid request interval/);
});
