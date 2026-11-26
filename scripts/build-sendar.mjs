import {spawnSync} from 'node:child_process';
import {cp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import './stage-release.mjs';
const root=path.resolve(import.meta.dirname,'..'),frontend=path.join(root,'design/sendar-workspace');
const build=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{cwd:frontend,stdio:'inherit'});
if(build.status)process.exit(build.status);
for(const destination of ['public/sendar','.pages-release/sendar']){await mkdir(path.join(root,destination),{recursive:true});await cp(path.join(frontend,'dist'),path.join(root,destination),{recursive:true});}
console.log('Sendar release staged separately at /sendar/. Existing dashboard preserved.');
