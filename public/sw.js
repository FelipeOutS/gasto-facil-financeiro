/**
 * Gasto Inteligente — SERVICE WORKER DE LIMPEZA (PWA STABILITY MODE)
 *
 * Incidente P0 (2026-08-07): o `sw.js` anterior usava um BUILD_ID literal fixo
 * (`2026-08-06-P0`), portanto era byte-idêntico em todos os deploys. O navegador
 * recorrente nunca via um Service Worker novo e continuava controlado por um
 * worker antigo (com cache de HTML/chunks), servindo assets de builds que já não
 * existem — daí o "Algo deu errado / Estamos atualizando esta tela" que só o
 * Ctrl + Shift + R (que ignora o Service Worker) resolvia, e que nunca aparecia
 * em guia anônima (sem Service Worker).
 *
 * Este worker existe para EVICTAR a registration antiga de forma definitiva:
 *   - remove apenas os caches próprios do app (prefixo "gi-");
 *   - assume o controle e recarrega as abas abertas uma única vez;
 *   - remove a própria registration em `finally` (o `activate` só ocorre uma vez;
 *     sem o `finally`, qualquer rejeição deixaria o worker registrado para sempre).
 *
 * Não intercepta nada: navegação, assets com hash, APIs, auth, Mercado Pago e
 * WhatsApp passam direto pela rede/cache HTTP do navegador. O manifest e os
 * ícones continuam publicados, então a instalação na tela inicial segue
 * funcionando; o modo offline fica temporariamente desativado.
 *
 * Caches de terceiros (ex.: Firebase Messaging) NÃO são tocados: o Cache Storage
 * é por origem, então apagamos somente os nomes com prefixo "gi-".
 */

const APP_CACHE_PREFIX = "gi-";

function isAppOwnedCache(name) {
  return typeof name === "string" && name.startsWith(APP_CACHE_PREFIX);
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cacheNames = await caches.keys();
        const appCaches = cacheNames.filter(isAppOwnedCache);
        await Promise.allSettled(appCaches.map((name) => caches.delete(name)));

        await self.clients.claim();

        const windowClients = await self.clients.matchAll({ type: "window" });
        await Promise.allSettled(windowClients.map((client) => client.navigate(client.url)));
      } finally {
        await self.registration.unregister();
      }
    })(),
  );
});
