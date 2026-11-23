import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { onRequest } from '../functions/api/[[path]].js';
import { createTestDb } from './test-d1.mjs';
const db=createTestDb();
export const qaDb=db;
const allowed=new Set(['POST sending/start','POST campaign/prepare','POST campaign/review','GET analytics','GET state','GET notifications','POST notifications/delete','POST notifications/delete-read','POST account/health/read','POST campaign/cancel','POST campaign/rebalance','GET thread','GET sending/status','POST import','POST import/progress','POST import/batch/delete','POST template','POST template/update','POST template/status','POST template/delete','POST account','POST account/cap','POST settings','POST thread/update']);
export const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:4175');
 if(url.pathname.startsWith('/api/')){
  if(!allowed.has(req.method+' '+url.pathname.slice(5))){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Email delivery and provider connections are disabled in local QA.'}));return;}
  let body='';for await(const chunk of req)body+=chunk;
  const response=await onRequest({request:new Request(url,{method:req.method,headers:{...req.headers,origin:url.origin},...(body?{body}:{})}),env:{DB:db}});
  res.writeHead(response.status,Object.fromEntries(response.headers));if(url.pathname==='/api/import/progress'){for await(const chunk of response.body){res.write(chunk);if(process.env.QA_SLOW_PROGRESS)await new Promise(resolve=>setTimeout(resolve,80));}res.end();}else res.end(await response.text());return;
 }
 const file=path.resolve('design/mail-dash-builder/dist','.'+(url.pathname==='/'?'/index.html':url.pathname));
 const base=path.resolve('design/mail-dash-builder/dist');if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
 const type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream';const content=await readFile(file);res.writeHead(200,{'Content-Type':type});res.end(content);
}catch(e){if(!res.headersSent)res.writeHead(e.code==='ENOENT'?404:500);res.end(e.message);}});
if(import.meta.url===new URL(process.argv[1], 'file:///').href)server.listen(4175,'127.0.0.1',()=>console.log('Local QA only: http://127.0.0.1:4175'));
