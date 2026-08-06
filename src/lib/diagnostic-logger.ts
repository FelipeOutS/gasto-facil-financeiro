export async function logClientError(data: any) {
  try {
    await fetch('/api/public/client-load-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        user_agent: navigator.userAgent,
        navigator_online: navigator.onLine,
        js_build_id: '2026-08-06-P0',
        deployment_id: (window as any).DEPLOYMENT_ID || 'unknown',
        sw_state: navigator.serviceWorker?.controller?.state || 'none',
        sw_controller_url: navigator.serviceWorker?.controller?.scriptURL || 'none',
        anonymous_id: localStorage.getItem('gi:anon-id') || undefined
      })
    });
  } catch (e) {
    console.error('[Diagnostic Logger] Failed to send report', e);
  }
}
