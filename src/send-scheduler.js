import { SEND_CONCURRENCY as concurrency, SENDS_PER_INVOCATION as sendsPerInvocation, MAX_SEND_ATTEMPTS as maximumAttempts } from './send-limits.mjs';

export default {
  async scheduled(_controller, env) {
    if (!env.DASHBOARD_API_URL || !env.BACKGROUND_CRON_SECRET) {
      console.error('Background sender is missing its dashboard URL or shared secret.');
      return;
    }
    const baseUrl = env.DASHBOARD_API_URL.replace(/\/+$/, '');
    let remaining = sendsPerInvocation, attempts = 0, stopped = false;
    const worker = async (senderSlot) => {
      while (!stopped && remaining > 0 && attempts < maximumAttempts) {
        remaining--; attempts++;
        try {
          const response = await fetch(`${baseUrl}/api/internal/send-tick`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.BACKGROUND_CRON_SECRET}`, Origin: baseUrl, 'Content-Type': 'application/json' },
            body: JSON.stringify({senderSlot})
          });
          const result = await response.json();
          if (!response.ok || Number(result.httpStatus || 200) >= 400 || result.error) {
            if(!stopped)console.error('Background send tick was rejected:', result.httpStatus || response.status, result.error || '');
            stopped = true; return;
          }
          if (result.busy) {
            remaining++;
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
          }
          if (result.sent !== true && result.failed !== true && result.deferred !== true) { stopped = true; return; }
        } catch {
          // Never retry a request with unknown delivery confirmation.
          if(!stopped)console.error('Background send tick did not return confirmation; stopping this invocation.');
          stopped = true; return;
        }
      }
    };
    await Promise.all(Array.from({length:concurrency},(_,senderSlot)=>worker(senderSlot)));
  }
};
