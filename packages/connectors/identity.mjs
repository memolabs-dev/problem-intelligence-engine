import {createHash} from 'node:crypto';

/** Stable pseudonymous key for a public account within one service.
 * This is NOT proof of a unique human and is NOT cryptographic anonymization.
 */
export function accountKey(source,externalAccountId){
 if(!['github','hackernews'].includes(source))throw new Error('Unsupported account provider');
 if(externalAccountId==null||String(externalAccountId).trim()==='')return null;
 return createHash('sha256').update(source+'\u0000'+String(externalAccountId)).digest('hex');
}
