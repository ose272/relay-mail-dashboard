import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function createTestDb(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 // The local test database never inherits production credentials or messages.
 sqlite.exec('DELETE FROM templates');
 let queue=Promise.resolve();
 const serial=work=>{const result=queue.then(work);queue=result.catch(()=>{});return result;};
 const adapt=(sql,values=[])=>{
  const run=()=>{const r=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(r.changes)}};};
  return {bind:(...args)=>{if(args.length>100)throw new Error('D1 parameter limit exceeded');return adapt(sql,args);},first:()=>serial(()=>sqlite.prepare(sql).get(...values)||null),all:()=>serial(()=>({results:sqlite.prepare(sql).all(...values)})),run:()=>serial(run),_run:run};
 };
 return {sqlite,prepare:sql=>adapt(sql),batch:statements=>serial(()=>{sqlite.exec('BEGIN');try{const results=statements.map(statement=>statement._run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}})};

}
