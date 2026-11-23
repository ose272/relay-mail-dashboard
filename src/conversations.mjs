export async function mergeConversation(db,thread,account,messages){
 let imported=0;const moved=new Set(),known=new Map(),writes=[],inserts=[];
 const ids=[...new Set(messages.map(m=>m.messageId).filter(Boolean))];
 for(let offset=0;offset<ids.length;offset+=98){const chunk=ids.slice(offset,offset+98);const found=await db.prepare(`SELECT m.id,m.thread_id,m.direction,m.send_state,m.message_id FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.account_id=? AND m.message_id IN (${chunk.map(()=>'?').join(',')}) ORDER BY (m.thread_id=?) DESC`).bind(account.id,...chunk,thread.id).all();for(const row of found.results || [])if(!known.has(row.message_id))known.set(row.message_id,row);}
 for(const message of messages){
  const outgoing=message.fromAddress.toLowerCase()===account.email.toLowerCase(),existing=message.messageId?known.get(message.messageId):null;
  if(existing){
   if(outgoing && existing.direction==='out' && ['sending','uncertain'].includes(existing.send_state)){writes.push(db.prepare("UPDATE messages SET send_state='sent' WHERE id=? AND direction='out' AND send_state IN ('sending','uncertain')").bind(existing.id));existing.send_state='sent';}
   if(existing.thread_id!==thread.id){writes.push(db.prepare('UPDATE messages SET thread_id=?,sender_email=?,sender_name=? WHERE id=?').bind(thread.id,message.fromAddress,message.fromName || '',existing.id));moved.add(existing.thread_id);existing.thread_id=thread.id;}
   continue;
  }
  const id=crypto.randomUUID();inserts.push(writes.length);
  writes.push(db.prepare(`INSERT OR IGNORE INTO messages(id,thread_id,direction,body,time,message_id,in_reply_to,references_json,external_id,send_state,sender_email,sender_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,thread.id,outgoing?'out':'in',message.text,message.date,message.messageId,message.inReplyTo || '',JSON.stringify(message.references || []),`${account.id}:${message.externalId}`,outgoing?'sent':'received',message.fromAddress,message.fromName || ''));
  if(message.messageId)known.set(message.messageId,{id,thread_id:thread.id,direction:outgoing?'out':'in',send_state:outgoing?'sent':'received'});
 }
 const insertSet=new Set(inserts);
 for(let offset=0;offset<writes.length;offset+=100){const results=await db.batch(writes.slice(offset,offset+100));results.forEach((result,i)=>{if(insertSet.has(offset+i))imported+=Number(result.meta?.changes || 0);});}
 const latest=messages.at(-1);
 const newest=latest?await db.prepare("SELECT MAX(time) AS time FROM messages WHERE thread_id=? AND (direction='in' OR (direction='out' AND send_state='sent'))").bind(thread.id).first():null;
 if(latest && latest.date>=String(newest?.time || ''))await db.prepare('UPDATE threads SET status=?,unread=? WHERE id=?').bind(latest.fromAddress.toLowerCase()===account.email.toLowerCase()?'Replied':'Needs reply',latest.fromAddress.toLowerCase()===account.email.toLowerCase()?0:Number(latest.unread),thread.id).run();
 return {imported,movedThreadIds:[...moved]};
}
