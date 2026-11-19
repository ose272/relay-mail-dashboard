import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
// The API uses both migrations. Fail closed instead of deploying against a
// quota-blocked database or a schema that has not been updated yet.
const schemaCheck=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','relay-mail-dashboard','--remote','--config','wrangler.production.jsonc','--command',"SELECT name FROM d1_migrations WHERE name IN ('0026_cached_sender_budget.sql','0027_app_usage_guard.sql')",'--json'],{encoding:'utf8'});
let applied=[];
try{applied=JSON.parse(schemaCheck.stdout||'[]').flatMap(result=>result.results||[]);}catch{}
if(schemaCheck.status || applied.length!==2){
 console.error('Deployment held: apply migrations 0026 and 0027 after D1 quota is available. No production configuration was changed.');
 process.exit(1);
}
const original=await readFile('wrangler.jsonc');
try {
 const production=JSON.parse(await readFile('wrangler.production.jsonc','utf8'));
 production.pages_build_output_dir='./.pages-release';
 await writeFile('wrangler.jsonc',JSON.stringify(production,null,2));
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','pages','deploy','./.pages-release','--project-name=relay-mail-dashboard','--branch=main','--commit-dirty=true','--commit-message=Connect Mail Dash React UI to production API'],{stdio:'inherit'});
 if(result.status)process.exitCode=result.status;
}finally{await writeFile('wrangler.jsonc',original);console.log('Restored placeholder Wrangler configuration.');}
