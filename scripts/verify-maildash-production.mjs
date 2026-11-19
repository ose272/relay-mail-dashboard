import { readFile } from 'node:fs/promises';
const base='https://relay-mail-dashboard-9uo.pages.dev';
const html=await readFile('.pages-release/index.html','utf8');
const paths=['/','/login','/api/state','/api/sending/status',...Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g),m=>m[1])];
for(const path of paths){const r=await fetch(base+path,{redirect:'manual'});const type=r.headers.get('content-type')||'';console.log(JSON.stringify({path,status:r.status,type,location:r.headers.get('location')}));if(path.startsWith('/assets/')){const text=await r.text();if(r.status!==200 || type.includes('text/html') || /INITIAL_SENDING_STATE|clovisfinance|bentohealth|Quick follow-up on Q4/.test(text))throw new Error('Invalid production asset');}}
