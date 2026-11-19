const deliveryMessageId=/<([a-f0-9-]{36})@relay-mail-dashboard\.pages\.dev>/gi;
export function extractBounceReports(message) {
 const from=String(message.fromAddress || '').toLowerCase();
 if(!/^(mailer-daemon|postmaster)@/.test(from))return [];
 const parts=[message.text || '',...(message.attachments || []).filter(a=>['message/delivery-status','text/rfc822-headers','message/rfc822'].includes(a.contentType)).map(a=>String(a.content).slice(0,64000))];
 const text=parts.join('\n').replace(/\r\n/g,'\n');
 const ids=[...new Set([...text.matchAll(deliveryMessageId),...[message.inReplyTo,...(message.references || [])].flatMap(v=>[...String(v || '').matchAll(deliveryMessageId)])].map(m=>m[1].toLowerCase()))].slice(0,10);
 if(!ids.length)return [];
 const reports=[];
 for(const block of text.split(/\n\s*\n/)){
  const recipient=block.match(/^(?:Final|Original)-Recipient:\s*[^;\n]+;\s*([^\s<>]+@[^\s<>]+)/im)?.[1]?.toLowerCase();
  const status=block.match(/^Status:\s*(5\.\d{1,3}\.\d{1,3})\b/im)?.[1];
  if(recipient && status && !/^Action:\s*(?:delayed|delivered|relayed|expanded)\b/im.test(block))reports.push({recipient,status,deliveryIds:ids});
 }
 return reports.slice(0,25);
}

export async function recordBounceReports(db,accountId,messages) {
 let recorded=0;
 for(const message of messages){for(const report of message.bounceReports || []){
  for(const id of report.deliveryIds){
   const delivery=await db.prepare(`SELECT d.id,d.campaign_id,d.status,d.started_at,d.sent_at FROM campaign_deliveries d JOIN leads l ON l.id=d.lead_id
     WHERE d.id=? AND d.account_id=? AND lower(l.email)=? AND d.status IN ('sent','uncertain')`).bind(id,accountId,report.recipient.toLowerCase()).first();
   if(!delivery)continue;
   const statements=[];
   if(delivery.status==='uncertain')statements.push(db.prepare("UPDATE campaign_deliveries SET status='sent',sent_at=COALESCE(sent_at,started_at,?) WHERE id=? AND status='uncertain'").bind(message.date,id));
   statements.push(db.prepare('INSERT OR IGNORE INTO delivery_bounces(delivery_id,campaign_id,received_at,code,external_id) VALUES(?,?,?,?,?)').bind(id,delivery.campaign_id,message.date,'DSN_'+report.status.replaceAll('.','_'),`${accountId}:${message.externalId}`));
   const results=await db.batch(statements);recorded+=Number(results.at(-1).meta?.changes || 0);break;
  }
 }}
 return recorded;
}
