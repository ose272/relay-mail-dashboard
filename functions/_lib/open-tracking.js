const encoder = new TextEncoder();

async function key(secret) {
    return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function openTrackingUrl(origin, deliveryId, secret) {
    if (!secret) throw new Error('Open tracking is not configured.');
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode('relay-open:' + deliveryId)));
    return new URL(`/track/open/${deliveryId}.${Array.from(signature, b => b.toString(16).padStart(2, '0')).join('')}.gif`, origin).href;
}

export async function verifyOpenToken(deliveryId, signature, secret) {
    if (!secret || !/^[a-f0-9-]{36}$/i.test(deliveryId) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const bytes = Uint8Array.from(signature.match(/../g), pair => parseInt(pair, 16));
    return crypto.subtle.verify('HMAC', await key(secret), bytes, encoder.encode('relay-open:' + deliveryId));
}

export function trackedHtml(text, url) {
    const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return `<div style="white-space:pre-wrap;font-family:Arial,sans-serif">${escape(text)}</div><img src="${escape(url)}" width="1" height="1" alt="" style="border:0;width:1px;height:1px">`;
}

export async function prepareOpenTracking(db, { deliveryId, campaignId, templateId }) {
    await db.prepare(`INSERT OR IGNORE INTO delivery_open_tracking(delivery_id, campaign_id, template_id) VALUES(?,?,?)`).bind(deliveryId, campaignId, templateId).run();
}

export async function recordFirstOpen(db, deliveryId) {
    return db.prepare("UPDATE delivery_open_tracking SET first_open_at=? WHERE delivery_id=? AND open_enabled=1 AND first_open_at IS NULL").bind(new Date().toISOString(), deliveryId).run();
}
