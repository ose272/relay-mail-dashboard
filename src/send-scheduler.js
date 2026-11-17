const sendsPerInvocation = 15;

export default {
  async scheduled(_controller, env) {
    if (!env.DASHBOARD_API_URL || !env.BACKGROUND_CRON_SECRET) {
      console.error('Background sender is missing its dashboard URL or shared secret.');
      return;
    }
    const baseUrl = env.DASHBOARD_API_URL.replace(/\/+$/, '');
    for (let index = 0; index < sendsPerInvocation; index++) {
      let response;
      try {
        response = await fetch(`${baseUrl}/api/internal/send-tick`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.BACKGROUND_CRON_SECRET}`,
            Origin: baseUrl,
            'Content-Type': 'application/json'
          },
          body: '{}'
        });
      } catch (error) {
        console.error('Background send tick failed to reach the dashboard:', error);
        return;
      }

      let result;
      try {
        result = await response.json();
      } catch {
        console.error('Background send tick returned a non-JSON response:', response.status);
        return;
      }
      if (!response.ok) {
        console.error('Background send tick was rejected:', response.status, result.error || '');
        return;
      }
      if (!result.sent && !result.failed) return;
    }
  }
};
