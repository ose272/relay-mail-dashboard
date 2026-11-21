import { verifyOpenToken, recordFirstOpen } from '../../_lib/open-tracking.js';

const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));
const seenByDatabase = new WeakMap();

export async function onRequest({ request, env }) {
    const headers = { 'Content-Type': 'image/gif', 'Cache-Control': 'private, no-store, no-cache, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers });
    const match = new URL(request.url).pathname.match(/^\/track\/open\/([a-f0-9-]{36})\.([a-f0-9]{64})\.gif$/i);
    if (request.method === 'GET' && match && await verifyOpenToken(match[1], match[2], env.OPEN_TRACKING_SECRET)) {
        try {
            let seen = seenByDatabase.get(env.DB);
            if (!seen) { seen = new Map(); seenByDatabase.set(env.DB, seen); }
            if ((seen.get(match[1]) || 0) < Date.now()) {
                const result = await recordFirstOpen(env.DB, match[1]);
                seen.set(match[1], Date.now() + 300000);
                if (seen.size > 4096) seen.delete(seen.keys().next().value);
                if (result.meta?.changes) {
                    const day = new Date().toISOString().slice(0, 10);
                    await env.DB.prepare(`INSERT INTO app_usage_days(day, rows_read, rows_written) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET rows_read=rows_read+excluded.rows_read, rows_written=rows_written+excluded.rows_written`).bind(day, Number(result.meta?.rows_read || 1) + 2, Number(result.meta?.rows_written || 4) + 3).run().catch(() => {});
                }
            }
        } catch {}
    }
    return new Response(request.method === 'HEAD' ? null : gif, { headers });
}