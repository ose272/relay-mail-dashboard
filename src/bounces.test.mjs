import test from 'node:test';
import assert from 'node:assert/strict';
import {simpleParser} from 'mailparser';
import {extractBounceReports,recordBounceReports} from './bounces.mjs';
import {sendFailureHealth} from './send-health.mjs';
import {createTestDb} from '../scripts/test-d1.mjs';
import {onRequest} from '../functions/api/[[path]].js';
const id='11111111-1111-4111-8111-111111111111';
const recipient='lead@invalid.test';
const report={fromAddress:'mailer-daemon@googlemail.com',text:`Final-Recipient: rfc822; ${recipient}\nAction: failed\nStatus: 5.1.1\n\nMessage-ID: <${id}@relay-mail-dashboard.pages.dev>`};
test('bounce parser requires a permanent DSN, original delivery ID and recipient',()=>{
 assert.equal(extractBounceReports(report).length,1);
 assert.equal(extractBounceReports({...report,fromAddress:recipient}).length,0);
 assert.equal(extractBounceReports({...report,text:report.text.replace('5.1.1','4.2.0')}).length,0);
 assert.equal(extractBounceReports({...report,text:report.text.replace('Action: failed','Action: delayed')}).length,0);
 assert.equal(extractBounceReports({...report,text:'Please unsubscribe'}).length,0);
});
test('MIME delivery-status and attached original headers produce an exact bounce report',async()=>{
 const raw=`From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>\r\nTo: sender@invalid.test\r\nSubject: Delivery Status Notification (Failure)\r\nMIME-Version: 1.0\r\nContent-Type: multipart/report; report-type=delivery-status; boundary=dsn\r\n\r\n--dsn\r\nContent-Type: text/plain\r\n\r\nAddress not found.\r\n--dsn\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; googlemail.com\r\n\r\nFinal-Recipient: rfc822; ${recipient}\r\nAction: failed\r\nStatus: 5.1.1\r\n\r\n--dsn\r\nContent-Type: text/rfc822-headers\r\n\r\nMessage-ID: <${id}@relay-mail-dashboard.pages.dev>\r\nTo: ${recipient}\r\n\r\n--dsn--\r\n`;
 const parsed=await simpleParser(raw,{skipHtml:true});const result=extractBounceReports({fromAddress:parsed.from.value[0].address,text:parsed.text,attachments:parsed.attachments});assert.deepEqual(result,[{recipient,status:'5.1.1',deliveryIds:[id]}]);
});
function fixture(status='sent'){
 const db=createTestDb(),s=db.sqlite,now=new Date().toISOString();s.prepare("INSERT INTO accounts(id,email,cap,created_at) VALUES('a','sender@invalid.test',40,?)").run(now);s.prepare("INSERT INTO leads(id,email,created_at) VALUES('l',?,?)").run(recipient,now);s.prepare("INSERT INTO templates(id,name,subject,body,created_at) VALUES('p','Plan','','Hello',?)").run(now);s.prepare("INSERT INTO campaigns(id,name,template_id,status,created_at,allocation_json,planned_sends,pending_count) VALUES('c','Direct send','p','Sending',?,'[]',1,1)").run(now);s.prepare("INSERT INTO campaign_deliveries(id,campaign_id,account_id,lead_id,batch_no,day_no,created_at) VALUES(?,'c','a','l',1,1,?)").run(id,now);s.prepare("UPDATE campaign_deliveries SET status='sending',started_at=? WHERE id=?").run(now,id);s.prepare("UPDATE campaign_deliveries SET status=?,sent_at=? WHERE id=?").run(status,status==='sent'?now:null,id);return {db,s,now};
}
test('bounce reconciliation updates failed activity once and preserves consumed quota',async()=>{
 const {db,s,now}=fixture();try{
 const message={date:now,externalId:'dsn:1',bounceReports:extractBounceReports(report)};
 assert.equal(await recordBounceReports(db,'wrong',[message]),0);
 assert.equal(await recordBounceReports(db,'a',[{...message,bounceReports:[{...message.bounceReports[0],recipient:'other@invalid.test'}]}]),0);
 assert.equal(await recordBounceReports(db,'a',[message]),1);assert.equal(await recordBounceReports(db,'a',[message]),0);
 const c=s.prepare("SELECT sent_count,failed_count,uncertain_count FROM campaigns WHERE id='c'").get();assert.deepEqual({...c},{sent_count:0,failed_count:1,uncertain_count:0});assert.equal(s.prepare("SELECT used_count FROM sender_budget WHERE account_id='a'").get().used_count,1);assert.equal(s.prepare('SELECT status FROM campaign_deliveries WHERE id=?').get(id).status,'sent');
 const response=await onRequest({request:new Request('http://localhost/api/sending/status'),env:{DB:db}});const data=await response.json();assert.equal(data.runs[0].failed,1);assert.equal(data.deliveries.filter(d=>d.id===id).length,1);assert.equal(data.deliveries[0].status,'failed');assert.equal(data.deliveries[0].last_error,'DSN_5_1_1');
 }finally{s.close();}
});
test('a matched permanent bounce resolves an uncertain send without resending or freeing quota',async()=>{
 const {db,s,now}=fixture('uncertain');try{await recordBounceReports(db,'a',[{date:now,externalId:'dsn:2',bounceReports:extractBounceReports(report)}]);const c=s.prepare("SELECT sent_count,failed_count,uncertain_count FROM campaigns WHERE id='c'").get();assert.deepEqual({...c},{sent_count:0,failed_count:1,uncertain_count:0});assert.equal(s.prepare("SELECT used_count FROM sender_budget WHERE account_id='a'").get().used_count,1);}finally{s.close();}
});
test('sending health distinguishes account restrictions, authentication, temporary limits and recipient failures',()=>{
 assert.equal(sendFailureHealth({responseCode:535}).status,'Problem');
 assert.equal(sendFailureHealth({responseCode:550,command:'MAIL FROM',response:'Your account has been suspended'}).status,'Restricted');
 assert.equal(sendFailureHealth({responseCode:550,command:'RCPT TO',response:'Recipient account disabled'}),null);
 assert.equal(sendFailureHealth({responseCode:550,response:'Daily sending limit exceeded'}).status,'Warning');
 assert.equal(sendFailureHealth({responseCode:550,response:'User does not exist'}),null);
 assert.equal(sendFailureHealth({code:'ETIMEDOUT'}),null);
});
