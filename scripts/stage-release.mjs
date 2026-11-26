import {readFile,cp,mkdir} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),release=path.join(root,'.pages-release');
const html=await readFile(path.join(root,'public/index.html'),'utf8');
await mkdir(path.join(release,'assets'),{recursive:true});
await cp(path.join(root,'public/index.html'),path.join(release,'index.html'));
for(const [,asset] of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g))await cp(path.join(root,'public',asset),path.join(release,asset));
for(const file of ['googleae5c9c582107a548.html','about.html','login.html','login.js','styles.css','signup.html','signin.html','welcome.html','customer-auth.js','customer-auth.css','_headers','_routes.json'])await cp(path.join(root,'public',file),path.join(release,file));
