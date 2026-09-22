/** Web Locks serialize tabs; IndexedDB claims also protect older WebViews.
 * Requests time out before the 120s persisted lease can be reclaimed.
 * A killed process releases its Web Lock; the next retry reclaims the stale lease. */
export async function withSyncAttempt(key: string, work: (signal: AbortSignal) => Promise<void>) {
  const run = async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Tempo de sincronização esgotado; tente novamente."));
      }, 60000);
    });
    try {
      await Promise.race([work(controller.signal), timeout]);
    } finally {
      clearTimeout(timer!);
      controller.abort();
    }
  };
  if (typeof navigator !== "undefined" && navigator.locks) {
    await navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
      if (lock) await run();
    });
  } else await run();
}
