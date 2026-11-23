export async function mergeConversation(db,thread,account,messages){
 let imported=0;const moved=new Set();
 for(const message of messages){
  const outgoing=message.fromAddress.toLowerCase()===account.email.toLowerCase();
  const existing=message.messageId?await db.prepare('SELECT m.id,m.thread_id FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.account_id=? AND m.message_id=? ORDER BY (m.thread_id=?) DESC LIMIT 1').bind(account.id,message.messageId,thread.id).first():null;
  if(existing){
   if(outgoing)await db.prepare("UPDATE messages SET send_state='sent' WHERE id=? AND direction='out' AND send_state IN ('sending','uncertain')").bind(existing.id).run();
   if(existing.thread_id!==thread.id){await db.prepare('UPDATE messages SET thread_id=?,sender_email=?,sender_name=? WHERE id=?').bind(thread.id,message.fromAddress,message.fromName,existing.id).run();moved.add(existing.thread_id);}
   continue;
  }
  const result=await db.prepare(`INSERT OR IGNORE INTO messages(id,thread_id,direction,body,time,message_id,in_reply_to,references_json,external_id,send_state,sender_email,sender_name)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),thread.id,outgoing?'out':'in',message.text,message.date,message.messageId,message.inReplyTo || '',JSON.stringify(message.references || []),`${account.id}:${message.externalId}`,outgoing?'sent':'received',message.fromAddress,message.fromName || '').run();
  imported+=Number(result.meta?.changes || 0);
 }
 const latest=messages.at(-1);
 const newest=latest?await db.prepare("SELECT MAX(time) AS time FROM messages WHERE thread_id=? AND (direction='in' OR (direction='out' AND send_state='sent'))").bind(thread.id).first():null;
 if(latest && latest.date>=String(newest?.time || ''))await db.prepare('UPDATE threads SET status=?,unread=? WHERE id=?').bind(latest.fromAddress.toLowerCase()===account.email.toLowerCase()?'Replied':'Needs reply',latest.fromAddress.toLowerCase()===account.email.toLowerCase()?0:Number(latest.unread),thread.id).run();
 return {imported,movedThreadIds:[...moved]};
}
