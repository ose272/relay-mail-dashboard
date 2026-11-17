function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, character => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
	}[character]));
}

function sendCountSummary(run) {
	let summary = String(run.plannedSends ?? run.assignments?.length ?? 0);
	if (run.sent) summary += ` · ${run.sent} sent`;
	if (run.pending) summary += ` · ${run.pending} pending`;
	if (run.uncertain) summary += ` · ${run.uncertain} needs review`;
	if (run.failed) summary += ` · ${run.failed} failed${run.failureCodes?.length ? ` (${run.failureCodes.join(', ')})` : ''}`;
	return summary;
}

function sendStatusLabel(status) {
	return status === 'Dry run' ? 'Preview ready' : status === 'Superseded' ? 'Replaced by direct send' : status;
}

export function renderSendingView(state, sendProgressMarkup, directSendLabel) {
	const runs = state.campaigns || [];
	const latest = runs.find(run => run.name === 'Direct send' && run.liveReady) || null;
	const sent = Number(latest?.sent || 0);
	const pending = Number(latest?.pending || 0);
	const failed = Number(latest?.failed || 0);
	const uncertain = Number(latest?.uncertain || 0);
	const icons = {
		sent: '<path d="m3 11 18-8-8 18-2-8-8-2Z"/><path d="m11 13 5-5"/>',
		queued: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
		failed: '<path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/>',
		review: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01"/>',
	};
	const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
	const metric = (label, value, foot, iconName) => `<article class="send-stat"><div class="send-stat-label">${label}<span>${icon(iconName)}</span></div><strong>${value.toLocaleString()}</strong><small>${foot}</small></article>`;
	const notice = latest && (uncertain || ['Needs review', 'User paused'].includes(latest.status) || failed)
		? `<section class="send-notice ${uncertain || latest.status === 'Needs review' ? 'attention' : ''}"><span class="send-notice-icon" aria-hidden="true">${icon('review')}</span><div><strong>${uncertain || latest.status === 'Needs review' ? 'Sending is paused for review' : latest.status === 'User paused' ? 'Sending is paused' : 'Some messages were rejected'}</strong><p>${uncertain || latest.status === 'Needs review' ? 'Check rejected and unconfirmed messages before resuming the queued work.' : latest.status === 'User paused' ? 'Resume the queued work when you are ready.' : 'Review failed messages; queued work can continue independently.'}</p></div><div class="actions">${uncertain ? `<button data-review-run="${escapeHtml(latest.id)}" aria-label="Review ${uncertain} unconfirmed messages">Review messages</button>` : ''}${latest.pending && ['Needs review', 'User paused', 'Paused', 'Scheduled'].includes(latest.status) ? `<button class="primary" data-resume-run="${escapeHtml(latest.id)}">Resume queued</button>` : ''}</div></section>`
		: '';
	const activity = runs.length
		? `<div class="table-wrap"><table class="send-runs-table"><thead><tr><th>Send run</th><th>Sender accounts</th><th>Result</th><th>Messages</th><th>Started</th><th>Actions</th></tr></thead><tbody>${runs.slice(0, 5).map(run => {
			const direct = run.name === 'Direct send' && run.liveReady;
			const active = direct && ['Sending', 'Scheduled', 'Paused'].includes(run.status);
			return `<tr data-send-run="${escapeHtml(run.id)}"><td><strong>${escapeHtml(run.name)}</strong></td><td>${new Set((run.assignments || []).map(item => item.accountId)).size}</td><td><span class="badge ${run.status === 'Sending' ? 'sending' : ''}" data-send-status>${escapeHtml(sendStatusLabel(run.status))}</span></td><td data-send-counts>${escapeHtml(sendCountSummary(run))}</td><td>${escapeHtml(new Date(run.created).toLocaleString())}</td><td><div class="actions">${direct && run.pending && ['Needs review', 'User paused', 'Paused', 'Scheduled'].includes(run.status) ? `<button data-resume-run="${escapeHtml(run.id)}">Resume queued</button>` : ''}${active ? `<button data-pause-run="${escapeHtml(run.id)}">Pause</button>` : ''}${direct && run.uncertain ? `<button data-review-run="${escapeHtml(run.id)}">Review ${run.uncertain}</button>` : ''}</div></td></tr>`;
		}).join('')}</tbody></table></div>`
		: `<div class="empty"><h3>No sends yet.</h3><p>Start sending to your pending leads with one click.</p><button class="primary" data-action="start-send">${escapeHtml(state.mode === 'cloudflare' ? directSendLabel() : 'Initiate sending')}</button></div>`;
	const senderCount = new Set((latest?.assignments || []).map(item => item.accountId)).size;
	const sendingIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 18-8-8 18-2-8-8-2Z"/><path d="m11 13 5-5"/></svg>';

	return `<div class="sending-page">${notice}<div class="send-stats">${metric('Sent', sent, 'Confirmed by sender', 'sent')}${metric('Queued', pending, 'Waiting to send', 'queued')}${metric('Failed', failed, 'Provider rejected', 'failed')}${metric('Needs review', uncertain, 'Unconfirmed delivery', 'review')}</div><section class="panel sending-run-panel"><header class="sending-run-header"><span class="sending-run-icon">${sendingIcon}</span><div class="sending-run-title"><h2>Direct send</h2><p>Live send · background worker${senderCount ? ` · ${senderCount} sender accounts` : ''}</p></div>${latest ? `<span class="badge ${latest.status === 'Sending' ? 'sending' : 'amber'}">${escapeHtml(sendStatusLabel(latest.status))}</span><div class="actions">${latest.pending && ['Needs review', 'User paused', 'Paused', 'Scheduled'].includes(latest.status) ? `<button data-resume-run="${escapeHtml(latest.id)}">Resume</button>` : ''}${['Sending', 'Scheduled', 'Paused'].includes(latest.status) && latest.pending ? `<button data-pause-run="${escapeHtml(latest.id)}">Pause</button>` : ''}</div>` : ''}</header><div id="live-send-progress">${sendProgressMarkup(true, true)}</div><section class="send-activity"><div class="send-activity-header"><div><h3>Recent sending runs</h3><p>Latest runs first</p></div><button data-refresh-sends>Refresh</button></div>${activity}</section><p class="sending-footnote">Run summaries only. Unconfirmed messages require review before retry. The background worker continues while this dashboard is closed.</p></section></div>`;
}
