import { SEND_CONCURRENCY as concurrency, SENDS_PER_INVOCATION as sendsPerInvocation, MAX_SEND_ATTEMPTS as maximumAttempts } from './send-limits.mjs';

export default {
  async scheduled(_controller, env) {
    if (!env.DASHBOARD_API_URL || !env.BACKGROUND_CRON_SECRET) {
      console.error('Background sender is missing its dashboard URL or shared secret.');
      return;
    }
    const baseUrl = env.DASHBOARD_API_URL.replace(/\/+$/, '');
    if(_controller?.cron==='0 * * * *'){
      const response=await fetch(`${baseUrl}/api/internal/privacy-cleanup`,{method:'POST',headers:{Authorization:`Bearer ${env.BACKGROUND_CRON_SECRET}`}});
      if(!response.ok)console.error('Privacy cleanup did not confirm.');
      return;
    }
    let senderSlots=Array.from({length:concurrency},(_,slot)=>slot);
    try{
      let customerRemaining=200;
      for(let batch=0;batch<10&&customerRemaining>0;batch++){
        const response=await fetch(`${baseUrl}/api/internal/customer-send-tick`,{method:'POST',headers:{Authorization:`Bearer ${env.BACKGROUND_CRON_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify({limit:Math.min(20,customerRemaining)})});
        if(!response.ok){console.error('Customer send tick did not confirm; queued work remains saved.');break;}
        const result=await response.json();customerRemaining-=Number(result.attempted||0);
        if(!result.hasMore||!result.attempted)break;
      }
    }catch{console.error('Customer send tick response was not confirmed; no delivery is force-retried.');}
    try{
      const response=await fetch(`${baseUrl}/api/internal/prepare-tick`,{method:'POST',headers:{Authorization:`Bearer ${env.BACKGROUND_CRON_SECRET}`,Origin:baseUrl,'Content-Type':'application/json'},body:'{}'});
      const progress=await response.json();
      if(!response.ok || progress.preparing || progress.dispatchReady!==true)return;
      if(Array.isArray(progress.senderSlots)){senderSlots=[...new Set(progress.senderSlots)].filter(slot=>Number.isInteger(slot)&&slot>=0&&slot<concurrency).slice(0,concurrency);if(!senderSlots.length)return;}
    }catch{console.error('Preparation status was not confirmed; skipping dispatch.');return;}
    let remaining = sendsPerInvocation, attempts = 0, stopped = false, networkWarned=false;
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
            if(result.noReadySender)return;
            remaining++;
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
          }
          if (result.sent !== true && result.failed !== true && result.deferred !== true && result.reviewPending !== true) { stopped = true; return; }
        } catch {
          // Never retry a request with unknown delivery confirmation.
          if(!networkWarned)console.error('Background send tick did not return confirmation; stopping this lane without retrying its message.');
          networkWarned=true; return;
        }
      }
    };
    await Promise.all(senderSlots.map(senderSlot=>worker(senderSlot)));
  }
};
