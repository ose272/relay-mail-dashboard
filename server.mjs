import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocateRepeatedCampaign, assignScoutingPlans, parseLeads } from './src/domain.mjs';
import { syncFirstInbox } from './src/gmail.mjs';
const root=dirname(fileURLToPath(import.meta.url)); const db=resolve(root,'data/demo.json');
const seed=()=>({cap:40, accounts:Array.from({length:82},(_,i)=>({id:`a${i+1}`,email:`outreach.${String(i+1).padStart(2,'0')}@example.com`,cap:40,used:0,paused:false})),leads:[],templates:[{id:'t1',name:'A thoughtful introduction',subject:'A quick idea for {{store}}',body:'Hi {{name}},\n\nI came across {{store}} and wanted to introduce myself. I have an idea that could be relevant to your business.\n\nWould you be open to a quick conversation?\n\nBest regards'}],campaigns:[],threads:[{id:'m1',name:'Olivia Chen',store:'Form & Field',email:'olivia@example.com',subject:'Re: A quick idea for Form & Field',accountId:'a27',unread:true,status:'Needs reply',messages:[{direction:'out',body:'Hi Olivia,\n\nI came across Form & Field and wanted to introduce myself. Would you be open to a quick conversation?',time:'Yesterday, 10:24 AM'},{direction:'in',body:'Hi there,\n\nThanks for reaching out! This sounds interesting. Could you share a little more about what you have in mind for our store?\n\nBest,\nOlivia',time:'Today, 9:42 AM'}]},{id:'m2',name:'Marcus Reed',store:'Northline Goods',email:'marcus@example.com',subject:'Re: Working together',accountId:'a12',unread:true,status:'Needs reply',messages:[{direction:'in',body:'Thanks for the introduction. Can you send over some examples of your work?',time:'Today, 8:18 AM'}]},{id:'m3',name:'Amara Johnson',store:'Studio Sunday',email:'amara@example.com',subject:'Re: Hello from our team',accountId:'a5',unread:false,status:'Replied',messages:[{direction:'in',body:'Next week works for me. Let’s reconnect then.',time:'Yesterday, 4:30 PM'}]}]});
await mkdir(dirname(db),{recursive:true}); let state; try {state=JSON.parse(await readFile(db,'utf8'));} catch(e){if(e.code!=='ENOENT')throw e; state=seed();}
state.leadImportBatches ||= [];
if(state.leads.length&&!state.leadImportBatches.length)state.leadImportBatches.push({id:'legacy-import',fileName:'Existing leads (uploads were combined)',createdAt:new Date().toISOString(),importedCount:state.leads.length,duplicateCount:0,invalidCount:0,leadIds:state.leads.map(lead=>lead.id)});
async function save(){await writeFile(db+'.tmp',JSON.stringify(state,null,2));await rename(db+'.tmp',db);}
let mutation=Promise.resolve();
const server=http.createServer(async(req,res)=>{
 const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/api/state')return json(200,{...state,mode:'demo'});
  if(req.method==='POST'&&(url.pathname==='/api/account/add'||url.pathname==='/api/account/cap')){
   if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(403,{error:'Cross-origin request blocked'});
   if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'JSON required'});
   let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>2_000_000)return json(413,{error:'Request too large.'});}
   const body=JSON.parse(raw||'{}');
   const run=async()=>{
    let result={ok:true};
    if(url.pathname==='/api/account/add'){
     const emails=typeof body.text==='string'?body.text.split(/\r?\n/):[];
     if(emails.length>1000)throw Error('Add no more than 1,000 account addresses at a time.');
     const seen=new Set(),existing=new Set(state.accounts.map(a=>a.email.toLowerCase()));
     let added=0,duplicates=0,invalid=0;
     for(const value of emails){const email=String(value).trim().toLowerCase();if(!email)continue;if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){invalid++;continue;}if(seen.has(email)||existing.has(email)){duplicates++;continue;}seen.add(email);state.accounts.push({id:`a${state.accounts.length+1}`,email,cap:state.cap,used:0,paused:false,connection:'Pending connection'});added++;}
     result={added,duplicates,invalid};
    }else{
     const cap=Number(body.cap);if(!Number.isInteger(cap)||cap<1||cap>40)throw Error('Enter a cap from 1 to 40.');
     const account=state.accounts.find(a=>a.id===body.id);if(!account)throw Error('Account not found.');account.cap=cap;
    }
    await save();return json(200,result);
   };mutation=mutation.then(run,run);await mutation;return;
  }
  if(req.method==='POST'&&url.pathname.startsWith('/api/')){
   if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)return json(403,{error:'Cross-origin request blocked'});
   if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'JSON required'});
   let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>10_000_000)return json(413,{error:'File too large. Maximum 10 MB.'});}
   const body=JSON.parse(raw||'{}');
   const run=async()=>{
    let result={ok:true};
    switch(url.pathname){
     case '/api/import':{
      if(typeof body.text!=='string')throw Error('Choose a CSV or TXT file.');
      const parsed=parseLeads(body.text,state.leads),all=parseLeads(body.text,[]);
      state.leads.push(...parsed.leads);
      const batch={id:crypto.randomUUID(),fileName:String(body.fileName||'Imported leads').replace(/[\\/]/g,'').trim()||'Imported leads',createdAt:new Date().toISOString(),importedCount:parsed.leads.length,duplicateCount:parsed.duplicates,invalidCount:parsed.invalid,leadIds:all.leads.map(item=>state.leads.find(lead=>lead.email.toLowerCase()===item.email.toLowerCase())?.id).filter(Boolean)};
      state.leadImportBatches.unshift(batch);
      result={imported:parsed.leads.length,duplicates:parsed.duplicates,invalid:parsed.invalid,batchId:batch.id};break;
     }
     case '/api/import/batch/delete':{
      const index=state.leadImportBatches.findIndex(batch=>batch.id===body.batchId);if(index<0)throw Error('Lead upload batch not found.');
      const batch=state.leadImportBatches[index],counts={deleted:0,archived:0,retained:0};
      for(const leadId of batch.leadIds){
       const otherBatch=state.leadImportBatches.some((other,i)=>i!==index&&other.leadIds.includes(leadId));
       const used=state.campaigns.some(campaign=>campaign.assignments?.some(assignment=>assignment.leadIds?.includes(leadId)));
       if(otherBatch){counts.retained++;continue;}
       const lead=state.leads.find(item=>item.id===leadId);if(!lead)continue;
       if(used){lead.status='Archived';counts.archived++;}else{state.leads=state.leads.filter(item=>item.id!==leadId);counts.deleted++;}
      }
      state.leadImportBatches.splice(index,1);result={ok:true,...counts};break;
     }
     case '/api/lead/update':{const lead=state.leads.find(item=>item.id===body.id),email=String(body.email||'').trim().toLowerCase();if(!lead)throw Error('Lead not found.');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid email address.');if(state.leads.some(item=>item.id!==lead.id&&item.email.toLowerCase()===email))throw Error('Another lead already uses this email address.');lead.email=email;lead.name=String(body.name||'').trim();lead.store=String(body.store||'').trim();break;}
     case '/api/lead/delete':{const index=state.leads.findIndex(item=>item.id===body.id);if(index<0)throw Error('Lead not found.');state.leads.splice(index,1);result={ok:true,archived:false};break;}
     case '/api/lead/restore':throw Error('Archived leads are only available in the hosted dashboard.');
     case '/api/template':case '/api/template/update':{const subject=typeof body.subject==='string'?body.subject.trim():'';if(typeof body.name!=='string'||!body.name.trim()||typeof body.body!=='string'||!body.body.trim())throw Error('Enter a plan name and message body.');if(/{{\s*(?!name\s*}}|store\s*}}|email\s*}})[^}]+}}/.test(body.body+subject))throw Error('Use only {{name}}, {{store}} or {{email}}.');if(url.pathname==='/api/template/update'){const template=state.templates.find(item=>item.id===body.id);if(!template)throw Error('Scouting plan not found.');template.name=body.name.trim();template.subject=subject;template.body=body.body;}else state.templates.push({id:crypto.randomUUID(),name:body.name.trim(),subject,body:body.body,archivedAt:null});break;}
     case '/api/template/delete':{const template=state.templates.find(item=>item.id===body.id);if(!template)throw Error('Scouting plan not found.');const used=state.campaigns.some(campaign=>campaign.templateId===template.id||campaign.assignments?.some(assignment=>assignment.templateId===template.id));if(used){template.archivedAt=template.archivedAt||new Date().toISOString();result={ok:true,archived:true};}else{state.templates=state.templates.filter(item=>item.id!==template.id);result={ok:true,archived:false};}break;}
     case '/api/template/restore':{const template=state.templates.find(item=>item.id===body.id);if(!template||!template.archivedAt)throw Error('Archived scouting plan not found.');template.archivedAt=null;break;}
     case '/api/account':{const a=state.accounts.find(a=>a.id===body.id);if(!a)throw Error('Account not found');a.paused=!a.paused;break;}
     case '/api/settings':{const cap=Number(body.cap);if(!Number.isInteger(cap)||cap<1||cap>40)throw Error('Enter a cap from 1 to 40.');state.cap=cap;state.accounts.forEach(a=>a.cap=cap);break;}
     case '/api/campaign':{if(!body.name?.trim())throw Error('Enter a campaign name.');const leads=state.leads.filter(l=>l.status==='Ready');const templates=state.templates.filter(template=>!template.archivedAt);if(!leads.length)throw Error('Import leads before creating a dry run.');if(!templates.length)throw Error('Create a scouting plan before creating a campaign.');const allocation=allocateRepeatedCampaign(leads,state.accounts,state.cap);if(!allocation.assignments.length)throw Error('No available account capacity.');const planned=assignScoutingPlans(allocation.assignments,templates,leads);if(planned.missingAccountId)throw Error('No scouting plan has complete personalization for every recipient assigned to a sender account.');const assignments=planned.assignments.map(({batch,day,accountId,leadIds,templateId,templateName})=>({batch,day,accountId,leadIds,count:leadIds.length,templateId,templateName}));state.campaigns.unshift({id:crypto.randomUUID(),name:body.name.trim(),templateId:planned.assignments[0].templateId,status:'Dry run',created:new Date().toISOString(),days:allocation.days,batches:allocation.batches,plannedSends:allocation.sends,liveReady:false,assignments,remaining:allocation.remaining});break;}
     case '/api/read':{const t=state.threads.find(t=>t.id===body.id);if(t)t.unread=false;break;}
     case '/api/reply':{const t=state.threads.find(t=>t.id===body.id);if(!t||!body.text?.trim())throw Error('Write a reply first.');t.messages.push({direction:'out',body:body.text.trim(),time:'Just now · demo only'});t.status='Replied';t.unread=false;result={ok:true,account:state.accounts.find(a=>a.id===t.accountId).email};break;}
     case '/api/mail/sync':return json(200,await syncFirstInbox(resolve(root,'app password.txt'),state.accounts));
     default:return json(404,{error:'Not found'});
    }await save();return json(200,result);
   };mutation=mutation.then(run,run);await mutation;return;
  }
  const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css'};const f=files[url.pathname];if(!f){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html','Content-Security-Policy':"default-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});res.end(await readFile(resolve(root,'public',f)));
 }catch(e){json(400,{error:e.message});}
});
server.listen(3000,'127.0.0.1',()=>console.log('Relay is ready at http://127.0.0.1:3000 — demo mode; live sending disabled'));
