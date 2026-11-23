/** Clear all timers/listeners on lock, navigation or identity change. */
export function bindVaultAutoLock(lock: () => void, idleMs: number, hiddenMs = 60000) {
  let closed = false;
  let hiddenAt: number | null = null;
  const expire = () => {
    if (!closed) {
      closed = true;
      lock();
    }
  };
  let timer = setTimeout(expire, idleMs);
  const bump = () => {
    if (!closed) {
      clearTimeout(timer);
      timer = setTimeout(expire, idleMs);
    }
  };
  const visibility = () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt !== null && Date.now() - hiddenAt >= hiddenMs) expire();
  };
  const events = ["pointerdown", "keydown", "scroll"];
  events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
  document.addEventListener("visibilitychange", visibility);
  return () => {
    closed = true;
    clearTimeout(timer);
    events.forEach((e) => window.removeEventListener(e, bump));
    document.removeEventListener("visibilitychange", visibility);
  };
}

export function watchVaultVersion(
  read: () => Promise<number | null>,
  expected: number,
  lock: () => void,
  intervalMs = 15000,
) {
  let alive = true,
    busy = false;
  const timer = setInterval(async () => {
    if (!alive || busy) return;
    busy = true;
    try {
      const version = await read();
      if (alive && version !== expected) {
        alive = false;
        lock();
      }
    } catch {
      if (alive) {
        alive = false;
        lock();
      }
    } finally {
      busy = false;
    }
  }, intervalMs);
  return () => {
    alive = false;
    clearInterval(timer);
  };
}
