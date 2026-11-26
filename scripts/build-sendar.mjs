import {spawnSync} from 'node:child_process';
import {cp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import './stage-release.mjs';
const root=path.resolve(import.meta.dirname,'..'),frontend=path.join(root,'design/sendar-workspace');
const build=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{cwd:frontend,stdio:'inherit'});
if(build.status)process.exit(build.status);
for(const destination of ['public/sendar','.pages-release/sendar']){
 const target=path.resolve(root,destination);
 if(!target.startsWith(root+path.sep)||path.basename(target)!=='sendar')throw Error('Invalid generated asset destination.');
 await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});await cp(path.join(frontend,'dist'),target,{recursive:true});
}
console.log('Sendar live-data interface staged at /sendar/.');
