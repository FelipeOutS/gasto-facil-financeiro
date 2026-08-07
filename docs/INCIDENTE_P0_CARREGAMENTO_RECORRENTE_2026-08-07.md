# INCIDENTE P0 — "Algo deu errado" recorrente em produção (2026-08-07)

## 1. Sintoma

Usuários recorrentes (mesmo navegador, sessão já existente) viam a tela global
de erro ao entrar no site ou ao navegar entre telas. A tela só voltava ao normal
com `Ctrl + Shift + R`. Em guia anônima nunca acontecia. Recarregar normal (F5)
frequentemente não resolvia.

## 2. Causa-raiz (comprovada)

Duas causas encadeadas:

**C1 — Service Worker imortal.** O `public/sw.js` continha um `BUILD_ID` como
string literal fixa (`2026-08-06-P0`). O navegador só instala um worker novo
quando o **byte** do arquivo muda; como o arquivo era idêntico em todos os
deploys, a registration antiga (versão anterior, com cache de HTML/chunks)
permanecia no controle indefinidamente e servia assets de builds que já não
existiam. `Ctrl + Shift + R` funcionava porque o hard reload ignora o Service
Worker; a guia anônima funcionava porque não tinha worker nenhum.

**C2 — Version skew de HTML.** O HTML não forçava revalidação, então um HTML
antigo (do cache do navegador/CDN) referenciava chunks com hash de um build já
substituído → `Failed to fetch dynamically imported module` na navegação.

Agravante: a rotina de recuperação anterior recarregava imediatamente após
limpar caches, sem comparar versões e sem guard de tentativa — risco de loop e
de recarregar em erros que não eram de carregamento.

## 3. Correção aplicada

| Área | Mudança |
| --- | --- |
| `vite.config.ts` | `BUILD_ID` gerado **uma vez por build** e injetado via `define` (`__GI_BUILD_ID__`, `__GI_DEPLOYED_AT__`) — mesmo valor no cliente, no servidor e no endpoint de versão. Nunca por request. |
| `src/lib/build-id.ts` | Passa a ler o valor injetado (substitui o antigo `build-id.server.ts` com literal fixa). |
| `public/sw.js` | **PWA STABILITY MODE**: worker de limpeza. Não intercepta nada; apaga apenas caches com prefixo `gi-`, assume controle, recarrega as abas uma vez e faz `unregister()` em `finally`. Caches de terceiros (ex.: Firebase Messaging) intactos. |
| `src/routes/__root.tsx` | Removido o registro de Service Worker e o `PWAUpdateToast`; agora chama `cleanupLegacyServiceWorkers()`. |
| `src/lib/sw-cleanup.ts` | Remove registrations de `/sw.js` e caches `gi-` remanescentes. Não toca em workers de terceiros. |
| `src/server.ts` | HTML e arquivos de controle (`/sw.js`, `/manifest.webmanifest`) com `Cache-Control: no-cache, must-revalidate` (+ `CDN-Cache-Control`). Assets com hash seguem imutáveis. |
| `src/lib/recovery.ts` | Classificação real do erro; recuperação **só** para falhas de asset **e só** quando o `buildId` do servidor difere do build carregado; guard em `localStorage` por par `<buildAntigo>:<buildNovo>` → no máximo **uma** recuperação automática. |
| `src/entry-client.tsx` | Instrumentação em `vite:preloadError`, `error` (captura, inclusive falha de `<script>`/CSS) e `unhandledrejection`. |
| `src/router.tsx` | Error boundary diagnostica sempre e delega a recuperação ao mesmo caminho único. |
| `src/routes/api/public/app-version.ts` | Retorna `{ buildId, deployedAt }` com `no-store`. |

### O que NUNCA é apagado

IndexedDB, LocalStorage (exceto a chave de guard `gi:version-recovery:*`),
cookies, sessão/Auth, dados financeiros e caches de terceiros. Nenhum
`caches.delete` indiscriminado permaneceu no código.

### Sem loop, por construção

Só recarrega quando há divergência **comprovada** de `buildId`; após o reload o
`buildId` do cliente passa a ser igual ao do servidor, então a condição deixa de
existir. Além disso, o guard persistente impede uma segunda tentativa para o
mesmo par de builds.

## 4. Efeito colateral aceito

O modo offline fica temporariamente desativado (o worker atual não cacheia). A
instalação na tela inicial continua funcionando (manifest + ícones publicados).
O offline pode ser reintroduzido depois via `vite-plugin-pwa` (`generateSW`,
`NetworkFirst` para navegação), após o parque de navegadores estar limpo.

## 5. Validação

- Suíte global executada 2x: 138 arquivos, **2353 pass**, 0 fail, 9 skip.
- Build de produção: `exit=0`; `BUILD_ID` idêntico no bundle do cliente e do
  servidor (`2026-08-07-msiwx25u` no build de verificação), provando a injeção
  única por build.
- Testes novos: `tests/recovery-version-skew.test.ts` (classificação, ausência de
  reload em build igual, guard anti-loop, preservação de caches de terceiros,
  sanitização de diagnóstico) e `tests/pwa.test.ts` atualizado para o modo
  estabilidade.
- Lint/typecheck dos arquivos alterados: sem erros.

## 6. Como confirmar em produção

1. `curl -sI https://gastointeligente.com.br/ | grep -i cache-control` → deve
   conter `no-cache`.
2. `curl -s https://gastointeligente.com.br/api/public/app-version` → `buildId`
   deve mudar a cada novo deploy.
3. DevTools → Application → Service Workers: após uma navegação, a lista deve
   ficar **vazia** (o worker de limpeza se remove).
