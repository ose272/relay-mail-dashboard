import {cp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),release=path.join(root,'.pages-release');
if(path.dirname(release)!==root||path.basename(release)!=='.pages-release')throw Error('Invalid release directory.');
await rm(release,{recursive:true,force:true});
await mkdir(release,{recursive:true});
for(const file of ['index.html','googleae5c9c582107a548.html','_headers','_routes.json'])await cp(path.join(root,'public',file),path.join(release,file));
