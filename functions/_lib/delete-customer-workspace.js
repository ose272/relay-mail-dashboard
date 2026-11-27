import {digest} from './google-identity.js';
import {SEND_WINDOW_MS} from '../../src/send-window.mjs';
// Called only after the handler verifies the current customer's session and intent.
export async function deleteCustomerWorkspace(db,user){
 const ws=user.workspace_id;
 const busy=await db.prepare("SELECT 1 AS busy FROM customer_test_deliveries WHERE workspace_id=? AND status='sending' LIMIT 1").bind(ws).first();
 if(busy)throw Error('Wait for the in-flight email to finish before deleting this account.');
 const mailboxes=(await db.prepare('SELECT id,email FROM customer_google_mailboxes WHERE workspace_id=?').bind(ws).all()).results;
 const cutoff=new Date(Date.now()-SEND_WINDOW_MS).toISOString(),statements=[];
 for(const mailbox of mailboxes)statements.push(db.prepare("INSERT INTO customer_retained_send_usage(id,sender_hash,status,used_at) SELECT id,?,status,COALESCE(sent_at,started_at) FROM customer_test_deliveries WHERE workspace_id=? AND mailbox_id=? AND status IN('sent','uncertain') AND COALESCE(sent_at,started_at)>? ON CONFLICT(id) DO NOTHING").bind(await digest(mailbox.email.toLowerCase()),ws,mailbox.id,cutoff));
 statements.push(
  db.prepare('DELETE FROM customer_google_oauth_states WHERE workspace_id=?').bind(ws),
  db.prepare('DELETE FROM customer_google_oauth_errors WHERE workspace_id=?').bind(ws),
  db.prepare('DELETE FROM customer_test_deliveries WHERE workspace_id=?').bind(ws),
  db.prepare('DELETE FROM customer_mail_threads WHERE workspace_id=?').bind(ws),
  db.prepare('DELETE FROM customer_google_mailboxes WHERE workspace_id=?').bind(ws),
  db.prepare('DELETE FROM customer_leads WHERE workspace_id=?').bind(ws),
  db.prepare('DELETE FROM customer_lead_batches WHERE workspace_id=?').bind(ws),
  db.prepare('DELETE FROM auth_workspaces WHERE id=? AND owner_user_id=?').bind(ws,user.id),
  db.prepare('DELETE FROM auth_users WHERE id=? AND NOT EXISTS(SELECT 1 FROM auth_workspaces WHERE owner_user_id=?)').bind(user.id,user.id)
 );
 await db.batch(statements);return {ok:true};
}
