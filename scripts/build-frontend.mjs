import { spawnSync } from 'node:child_process';
import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),frontend=path.join(root,'design/mail-dash-builder');
const run=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{cwd:frontend,stdio:'inherit'});
if(run.status)process.exit(run.status);
const html=(await readFile(path.join(frontend,'dist/index.html'),'utf8')).trimEnd()+'\n';
for(const [,asset] of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g))await readFile(path.join(frontend,'dist',asset));
await cp(path.join(frontend,'dist'),path.join(root,'public'),{recursive:true});
await writeFile(path.join(root,'public/index.html'),html);
// Release allowlist excludes legacy demo bundles, source assets and local files.
const release=path.join(root,'.pages-release');
await mkdir(path.join(release,'assets'),{recursive:true});
await writeFile(path.join(release,'index.html'),html);
const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m=>m[1]);
for(const asset of assets)await cp(path.join(frontend,'dist',asset),path.join(release,asset));
for(const file of ['login.html','login.js','styles.css','signup.html','signin.html','welcome.html','customer-auth.js','customer-auth.css','_headers','_routes.json'])await cp(path.join(root,'public',file),path.join(release,file));
console.log('React production build copied to public; Pages Functions remain in functions/.');
