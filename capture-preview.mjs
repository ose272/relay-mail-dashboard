import http from 'node:http';
http.createServer(async(req,res)=>{
 try{
 const options={method:req.method,headers:{'content-type':req.headers['content-type']||'application/json'}};
 if(req.method!=='GET'&&req.method!=='HEAD'){let body='';for await(const chunk of req)body+=chunk;options.body=body;}
 const upstream=await fetch('http://127.0.0.1:3000'+req.url,options);
 let content=await upstream.text();
 if(req.url==='/')content=content.replace('</head>','<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script></head>');
 res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'text/plain'});res.end(content);
 }catch(e){res.writeHead(502);res.end('Capture preview unavailable');}
}).listen(3001,'127.0.0.1',()=>console.log('Temporary Figma capture preview: http://127.0.0.1:3001'));
