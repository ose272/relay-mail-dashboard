// NOT IN builds indexed membership lists once, avoiding repeated scans of materialized LEFT JOIN sets.
export const eligibleLeadsSql = `
 SELECT l.id,l.email,l.name,l.store,l.status FROM leads l
 WHERE l.status='Ready'
 AND l.id NOT IN (SELECT lead_id FROM campaign_deliveries WHERE status IN ('sending','sent','uncertain') AND lead_id IS NOT NULL)
 AND lower(l.email) NOT IN (SELECT lower(th.email) FROM messages m JOIN threads th ON th.id=m.thread_id WHERE m.direction='out' AND m.send_state IN ('sending','sent','uncertain') AND th.email IS NOT NULL)
 ORDER BY l.created_at,l.email
`;
