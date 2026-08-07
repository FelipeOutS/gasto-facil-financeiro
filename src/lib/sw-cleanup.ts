/**
 * PWA STABILITY MODE — remoção da registration antiga do Service Worker.
 *
 * O app NÃO registra mais Service Worker. O `public/sw.js` publicado é um worker
 * de limpeza: navegadores recorrentes o recebem na próxima navegação (o sw.js é
 * servido com `Cache-Control: no-cache`), ele apaga apenas os caches "gi-" e
 * remove a própria registration.
 *
 * Esta função é a rede de segurança para o caso em que o worker antigo não
 * controla mais a página (e portanto não dispara o soft update): removemos a
 * registration diretamente pelo cliente. Nada de IndexedDB, LocalStorage,
 * cookies, sessão ou Auth é tocado.
 */
export async function cleanupLegacyServiceWorkers(): Promise<number> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return 0;

  let removed = 0;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      const scriptUrl =
        registration.active?.scriptURL ??
        registration.waiting?.scriptURL ??
        registration.installing?.scriptURL ??
        "";

      // Só o worker do próprio app (nunca workers de mensageria de terceiros).
      if (scriptUrl && !scriptUrl.endsWith("/sw.js")) continue;

      if (await registration.unregister()) removed += 1;
    }
  } catch {
    /* navegador sem permissão para Service Worker: nada a fazer */
  }

  // Caches remanescentes do app (o worker de limpeza já faz isso; aqui é
  // idempotente e cobre o caso em que ele nunca ativou).
  try {
    if (typeof caches !== "undefined") {
      for (const name of await caches.keys()) {
        if (name.startsWith("gi-")) await caches.delete(name);
      }
    }
  } catch {
    /* Cache Storage indisponível */
  }

  return removed;
}
