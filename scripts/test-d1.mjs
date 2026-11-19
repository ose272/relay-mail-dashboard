import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function createTestDb(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 // The local test database never inherits production credentials or messages.
 sqlite.exec('DELETE FROM templates');
 const adapt=(sql,values=[])=>({bind:(...args)=>adapt(sql,args),first:async()=>sqlite.prepare(sql).get(...values)||null,all:async()=>({results:sqlite.prepare(sql).all(...values)}),run:async()=>{const r=sqlite.prepare(sql).run(...values);return{success:true,meta:{changes:Number(r.changes)}};}});
 return {sqlite,prepare:sql=>{const base=adapt(sql);const bind=base.bind;base.bind=(...args)=>{if(args.length>100)throw new Error('D1 parameter limit exceeded');return bind(...args);};return base;},batch:async statements=>{sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
}
