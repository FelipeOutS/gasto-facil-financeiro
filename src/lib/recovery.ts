import { logClientError } from './diagnostic-logger';

export async function attemptRecovery(error: Error, type: string) {
  const pathname = window.location.pathname;
  const key = `gi:recovery:${pathname}`;
  
  // Prevent reload loops
  const lastAttempt = sessionStorage.getItem(key);
  if (lastAttempt && Date.now() - parseInt(lastAttempt) < 10000) {
    console.warn('[Recovery] Loop detected, showing error UI');
    return false;
  }
  sessionStorage.setItem(key, Date.now().toString());

  console.log('[Recovery] Attempting surgical recovery for:', type);
  
  await logClientError({
    error_type: type,
    error_name: error.name,
    error_message: error.message,
    stack_trace: error.stack,
    current_route: pathname,
    recovery_attempted: true
  });

  // Surgical cache cleanup
  if ('caches' in window) {
    const names = await caches.keys();
    for (const name of names) {
      if (name.startsWith('gi-')) {
        await caches.delete(name);
      }
    }
  }

  // SW Update
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage('SKIP_WAITING');
  }

  // Force reload
  window.location.reload();
  return true;
}
