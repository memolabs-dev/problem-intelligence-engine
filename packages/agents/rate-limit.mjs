import {setTimeout as sleep} from 'node:timers/promises';

// A process-local conservative cadence for free OpenRouter chat completions.
// This does not claim to replace the provider's actual rate-limit headers.
let nextSlot=0;
export async function waitForFreeModelSlot({intervalMs=Number(process.env.PIE_LLM_MIN_INTERVAL_MS||3300),now=Date.now,sleeper=sleep}={}){
 if(!Number.isFinite(intervalMs)||intervalMs<0||intervalMs>60000)throw RangeError('Invalid request interval');
 const instant=now();
 const scheduled=Math.max(instant,nextSlot);
 nextSlot=scheduled+intervalMs;
 if(scheduled>instant)await sleeper(scheduled-instant);
}
export function resetRateLimiterForTests(){nextSlot=0;}
