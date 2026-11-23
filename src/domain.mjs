export function allocate(leads, accounts, cap = 40) {
  const eligible = accounts.filter(a => !a.paused && (a.connection === undefined || a.connection === 'Verified via IMAP' || a.connection === 'Connected'));
  const counts = new Map(eligible.map(a => [a.id, Math.max(0, Math.min(a.cap ?? cap, cap) - (a.used ?? 0))]));
  const assignments = []; let cursor = 0;
  for (const lead of leads) {
    let selected;
    for (let n = 0; n < eligible.length; n++) {
      const a = eligible[(cursor + n) % eligible.length];
      if (counts.get(a.id) > 0) { selected = a; cursor = (cursor + n + 1) % eligible.length; break; }
    }
    if (!selected) break;
    counts.set(selected.id, counts.get(selected.id) - 1);
    assignments.push({ leadId: lead.id, accountId: selected.id });
  }
  return { assignments, remaining: leads.length - assignments.length };
}
export function allocateAcrossDays(leads, accounts, cap = 40) {
  const eligible = accounts.filter(a => !a.paused && (a.connection === undefined || a.connection === 'Verified via IMAP' || a.connection === 'Connected'));
  const assignments = [], daily = [];
  let offset = 0, day = 1;
  while (offset < leads.length) {
    const dayAccounts = day === 1 ? eligible : eligible.map(a => ({ ...a, used: 0 }));
    const allocation = allocate(leads.slice(offset), dayAccounts, cap);
    if (!allocation.assignments.length) break;
    assignments.push(...allocation.assignments.map(item => ({ ...item, day })));
    daily.push({ day, assigned: allocation.assignments.length, accounts: new Set(allocation.assignments.map(item => item.accountId)).size });
    offset += allocation.assignments.length;
    day++;
  }
  return { assignments, remaining: leads.length - assignments.length, days: daily.length, daily };
}
export function allocateRepeatedCampaign(leads, accounts, cap = 40, batchSize = 50) {
  const eligible = accounts.filter(a => !a.paused && (a.connection === undefined || a.connection === 'Verified via IMAP' || a.connection === 'Connected') && Math.min(40, cap, a.cap ?? cap) > 0);
  const groups = [];
  for (let start = 0; start < eligible.length; start += batchSize) {
    groups.push(eligible.slice(start, start + batchSize));
  }

  const assignments = [], assignedByAccount = new Map();
  const assignedLeadIds = new Map(eligible.map(account => [account.id, new Set()]));
  let uniqueOffset = 0, totalDays = 0, day = 1;
  while (uniqueOffset < leads.length) {
    const capacity = new Map(eligible.map(account => [
      account.id,
      Math.max(0, Math.min(40, cap, account.cap ?? cap) - (day === 1 ? account.used ?? 0 : 0))
    ]));
    const dayStart = uniqueOffset;
    const addAssignment = (batch, account, lead) => {
      const key = `${batch}:${day}:${account.id}`;
      let assignment = assignedByAccount.get(key);
      if (!assignment) {
        assignment = { batch, day, accountId: account.id, leadIds: [] };
        assignedByAccount.set(key, assignment);
        assignments.push(assignment);
      }
      assignment.leadIds.push(lead.id);
      assignedLeadIds.get(account.id).add(lead.id);
      capacity.set(account.id, capacity.get(account.id) - 1);
    };

    for (let batchIndex = 0; batchIndex < groups.length && uniqueOffset < leads.length; batchIndex++) {
      const group = groups[batchIndex];
      let groupCapacity = group.reduce((total, account) => total + capacity.get(account.id), 0);
      while (groupCapacity > 0 && uniqueOffset < leads.length) {
        for (const account of group) {
          if (capacity.get(account.id) <= 0 || uniqueOffset >= leads.length) continue;
          addAssignment(batchIndex + 1, account, leads[uniqueOffset]);
          uniqueOffset++;
          groupCapacity--;
        }
      }
    }

    if (uniqueOffset === leads.length) {
      let fillCursor = 0;
      for (let batchIndex = 0; batchIndex < groups.length; batchIndex++) {
        const group = groups[batchIndex];
        let groupCapacity = group.reduce((total, account) => total + capacity.get(account.id), 0);
        while (groupCapacity > 0) {
          let filled = false;
          for (const account of group) {
            if (capacity.get(account.id) <= 0) continue;
            let checked = 0;
            while (checked < leads.length && assignedLeadIds.get(account.id).has(leads[fillCursor].id)) {
              fillCursor = (fillCursor + 1) % leads.length;
              checked++;
            }
            if (checked === leads.length) continue;
            addAssignment(batchIndex + 1, account, leads[fillCursor]);
            fillCursor = (fillCursor + 1) % leads.length;
            groupCapacity--;
            filled = true;
          }
          if (!filled) break;
        }
      }
    }

    if (uniqueOffset > dayStart) totalDays = day;
    if (uniqueOffset === dayStart) {
      if (day === 1 && eligible.some(account => Math.min(40, cap, account.cap ?? cap) > 0)) {
        day++;
        continue;
      }
      break;
    }
    day++;
  }

  return {
    assignments,
    sends: assignments.reduce((total, assignment) => total + assignment.leadIds.length, 0),
    remaining: assignments.length ? 0 : leads.length,
    days: totalDays,
    batches: groups.length
  };
}
export function assignScoutingPlans(assignments, templates, leads, random = Math.random) {
  const leadsById = new Map(leads.map(lead => [lead.id, lead]));
  const leadsByAccount = new Map();
  for (const assignment of assignments) {
    let accountLeads = leadsByAccount.get(assignment.accountId);
    if (!accountLeads) {
      accountLeads = new Set();
      leadsByAccount.set(assignment.accountId, accountLeads);
    }
    for (const leadId of assignment.leadIds) accountLeads.add(leadId);
  }

  const planByAccount = new Map();
  for (const [accountId, leadIds] of leadsByAccount) {
    const recipientLeads = [...leadIds].map(leadId => leadsById.get(leadId));
    const eligibleTemplates = templates.filter(template => {
      const placeholders = [...`${template.subject || ''}${template.body}`.matchAll(/{{\s*(\w+)\s*}}/g)]
        .map(match => match[1]);
      return recipientLeads.every(lead => lead && placeholders.every(field => lead[field]));
    });
    if (!eligibleTemplates.length) return { assignments: [], missingAccountId: accountId };
    const index = Math.min(eligibleTemplates.length - 1, Math.floor(random() * eligibleTemplates.length));
    planByAccount.set(accountId, eligibleTemplates[index]);
  }

  return {
    assignments: assignments.map(assignment => ({
      ...assignment,
      templateId: planByAccount.get(assignment.accountId).id,
      templateName: planByAccount.get(assignment.accountId).name
    })),
    missingAccountId: null
  };
}
export function assessAccountHealth(check) {
  const failures = [
    !check.imap && { service: 'IMAP', ...check.imapError },
    !check.smtp && { service: 'SMTP', ...check.smtpError }
  ].filter(Boolean);
  if (!failures.length) return { status: 'Healthy', code: '', message: 'IMAP and SMTP checks passed.' };

  const restricted = failures.some(failure =>
    /(?:account|sender|user|mailbox)\s+(?:(?:is|has been|was)\s+)?(?:disabled|suspended|restricted|blocked)|(?:disabled|suspended|restricted|blocked)\s+(?:account|sender|user|mailbox)/i.test(failure.message || '')
  );
  const status = restricted ? 'Restricted' : check.imap ? 'Warning' : 'Problem';
  return {
    status,
    code: failures.map(failure => `${failure.service}:${failure.code || 'ERROR'}`).join(', ').slice(0, 100),
    message: failures.map(failure =>
      `${failure.service} check failed (${failure.code || 'ERROR'}): ${failure.message || 'Connection failed.'}`
    ).join('; ').slice(0, 500)
  };
}
export function parseLeads(text, existing = []) {
  // CSV supports escaped quotes, commas and multiline quoted fields.
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) { row.push(value.trim()); value = ''; if (c === '\n') { rows.push(row); row = []; } }
    else if (c !== '\r') value += c;
  }
  if (quoted) throw new Error('Unclosed quote in CSV. Please check the file.');
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return { leads: [], duplicates: 0, invalid: 0 };
  const header = rows[0].map(x => x.toLowerCase().replace(/^\uFEFF/, ''));
  const emailIndex = header.findIndex(x => ['email', 'email address', 'email_address'].includes(x));
  const hasHeader = emailIndex >= 0; const ei = hasHeader ? emailIndex : 0;
  const ni = header.findIndex(x => ['name', 'first_name', 'first name'].includes(x));
  const si = header.findIndex(x => ['store', 'company', 'store_name'].includes(x));
  const seen = new Set(existing.map(x => x.email.toLowerCase())); const leads = []; let duplicates = 0, invalid = 0;
  for (const r of rows.slice(hasHeader ? 1 : 0)) {
    if (!r.some(Boolean)) continue;
    const email = (r[ei] || '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { invalid++; continue; }
    if (seen.has(email)) { duplicates++; continue; } seen.add(email);
    leads.push({ id: crypto.randomUUID(), email, name: hasHeader && ni >= 0 ? r[ni] : '', store: hasHeader && si >= 0 ? r[si] : '', status: 'Ready' });
  }
  return { leads, duplicates, invalid };
}
