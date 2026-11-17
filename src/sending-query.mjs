// Build blocker sets once per send-start request. This avoids correlated scans of
// campaign_deliveries and messages for every ready lead.
export const eligibleLeadsSql = `
  WITH blocked_delivery_leads AS (
    SELECT DISTINCT lead_id
    FROM campaign_deliveries
    WHERE status IN ('sending', 'sent', 'uncertain')
  ),
  replied_addresses AS (
    SELECT DISTINCT lower(th.email) AS email
    FROM messages m
    JOIN threads th ON th.id = m.thread_id
    WHERE m.direction = 'out'
      AND m.send_state IN ('sending', 'sent', 'uncertain')
  )
  SELECT l.id, l.email, l.name, l.store, l.status
  FROM leads l
  LEFT JOIN blocked_delivery_leads bd ON bd.lead_id = l.id
  LEFT JOIN replied_addresses ra ON ra.email = lower(l.email)
  WHERE l.status = 'Ready'
    AND bd.lead_id IS NULL
    AND ra.email IS NULL
  ORDER BY l.created_at, l.email
`;
