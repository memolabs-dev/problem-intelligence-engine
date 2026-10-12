import {readFile} from 'node:fs/promises';
import {createPool} from './postgres.mjs';

export async function migrate(pool){
 const ddl=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
 await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
 await pool.query(ddl);
 return {schema:'schema.sql',idempotent:true};
}
if(process.argv[1]?.endsWith('/packages/storage/migrate.mjs')){
 const pool=createPool();
 try{console.log(JSON.stringify(await migrate(pool)));}
 finally{await pool.end();}
}
