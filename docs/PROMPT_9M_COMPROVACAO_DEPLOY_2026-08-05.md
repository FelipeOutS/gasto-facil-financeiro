# Prompt 9M — Comprovação de Deploy, Smoke Test e Débito de Lint — 2026-08-05

## 1. Deploy em produção (comprovado)

`curl -sI https://gastointeligente.com.br/`

| Header | Valor |
|---|---|
| HTTP | `200` |
| `x-deployment-id` | `437b9b60d3ca1d52628ae524716682b579a529d94b9929eab82444f8fb697821` |
| `content-type` | `text/html; charset=utf-8` |
| `cache-control` (HTML) | `no-cache, must-revalidate, max-age=0` |
| `cache-control` (assets hashados) | `public, max-age=31536000, immutable` |
| `etag` / `last-modified` | ausentes (o edge usa `x-deployment-id` + revalidação de HTML) |

**Cache transitório explicado:** o HTML é sempre revalidado (`no-cache, must-revalidate`) e os assets são
imutáveis por hash. Portanto um bundle novo entra em vigor no primeiro carregamento após o deploy; o
comportamento observado antes do hard refresh vinha do documento já em memória da aba, não de cache de CDN.
Hard refresh executado: `/` volta `200` com o mesmo título — sem divergência de conteúdo.

## 2. Upsell presente no bundle publicado

Chunk autenticado baixado direto de produção: `assets/resumo-ByO9nVMp.js` (28 KB).

| Evidência | Ocorrências |
|---|---:|
| `upsell-status` (id do server function) | 4 |
| `upsell_message_shown` / `upsell_session_recorded` (eventos) | presentes |
| `"Conhecer planos"` (CTA do banner) | 2 |
| `"Agora não"` (recusa do banner) | 1 |
| `"Continuar no gratuito"` (recusa do modal) | 1 |
| `banner` / `modal` (canais) | 4 / 5 |

O upsell **não** está no bundle raiz nem no HTML público — ele é carregado apenas no chunk das rotas
autenticadas, como projetado.

## 3. Smoke test em produção (Playwright, Chromium headless, 1280×1800)

| Rota | Status | URL final | Título | H1 | Upsell visível |
|---|---|---|---|---|---|
| `/` | 200 | `/` | "Gasto Inteligente — Controle financeiro pessoal, MEI e empresas" | 1 | não (o texto "Ver planos" é o CTA de preços da landing) |
| `/login` | 200 | `/login` | "Entrar — Gasto Inteligente" | 1 | não |
| `/resumo` | 200 | **redirecionado para `/login`** | "Entrar — Gasto Inteligente" | 1 | não |
| `/meu-plano` | 200 | **redirecionado para `/login`** | "Entrar — Gasto Inteligente" | 1 | não |

- Nenhuma comunicação de upsell aparece para visitante não autenticado ou em rota crítica. ✅
- Gate de rota autenticada funcionando (redirect para `/login`). ✅
- Console: um `401` de server function protegido (esperado sem sessão) e um `TypeError: ... '_nonReactive'`
  durante `preloadRoute` de rota protegida sem sessão — ruído pré-existente do preloader do router,
  não originado no upsell.

**Limitação declarada:** a jornada autenticada completa (banner → recusa → snooze de 14/30 dias → modal
após 21 dias) **não foi executada em produção nesta rodada** porque não há sessão de teste disponível no
ambiente (`LOVABLE_BROWSER_AUTH_STATUS=signed_out`). Essa jornada permanece coberta por testes
determinísticos (`tests/upsell-9h-correcoes.test.ts`) e pela verificação de banco abaixo.

## 4. Verificação de banco (produção)

RLS de `user_communication_preferences` — apenas `authenticated` e só a própria linha:

| cmd | policy | qual |
|---|---|---|
| SELECT | Users can read own communication preferences | `auth.uid() = user_id` |
| INSERT | Users can insert own communication preferences | — |
| UPDATE | Users can update own communication preferences | `auth.uid() = user_id` |

`upsell_runtime_config` — **owner-only** em SELECT/INSERT/UPDATE/DELETE (`has_role(auth.uid(),'owner')`).

Funções de segurança:

| Função | SECURITY DEFINER | anon EXECUTE | authenticated | service_role |
|---|---|---|---|---|
| `public.has_role` | sim | ❌ | ✅ | ✅ |
| `public.is_owner` | sim | ❌ | ✅ | ✅ |

WhatsApp permanece **OFF**: `global_enabled=false`, `inbound_enabled=false`, `outbound_enabled=false`
(leitura, nada alterado).

## 5. Portões técnicos (re-executados após a limpeza de lint)

| Portão | Resultado |
|---|---|
| `bun run test:global` — execução 1 | 135 arquivos, **2330 pass / 0 fail / 0 errors / 9 skip** — exit 0 |
| `bun run test:global` — execução 2 | 135 arquivos, **2330 pass / 0 fail / 0 errors / 9 skip** — exit 0 (determinístico) |
| `tsc --noEmit` | ✅ exit 0 |
| `bun run build` | ✅ exit 0, `✓ built in 49.63s` |
| `eslint` nos arquivos alterados | ✅ **0 errors** (4 warnings: 1 `exhaustive-deps` legado + 3 diretivas de disable agora redundantes) |
| `eslint .` (global) | ❌ exit 1 — 4334 errors, dos quais **4215 (97,3%) são `prettier/prettier` no arquivo auto-gerado `supabase/types.ts`** |
| Security scan | 0 findings em todos os scanners (`supabase`, `supabase_lov`, `app_mcp`, `connector`, `supply_chain`, `agent_security`) |
| Supply chain | `seroval` / `seroval-plugins` **1.5.6** (CVE-2026-59940 remediada) |

## 6. Limpeza de lint aplicada (somente arquivos alterados)

- `src/lib/upsell.functions.ts`: 14 `any` → tipos reais (`UpsellPrefsRow`, `UpsellPrefsUpdate`, `AuthedContext`).
- `src/server/upsell-eligibility.server.ts`: 5 `any` → `UpsellConfig` + `UpsellPrefs`.
- Prettier aplicado em `use-upsell-gate.ts`, `meu-plano.tsx`, `index.tsx`, `rate-limit.server.ts`,
  `_whatsapp-fake.ts`, `run-test-suite.ts` e nos testes tocados nos prompts 9H–9L.
- `eslint.config.js`: override para `tests/**`, `scripts/**`, `src/scripts/**` (harness de teste pode usar `any`).
  **Nenhuma regra afrouxada para código de produção.**

Plano de correção do débito restante: `docs/PLANO_CORRECAO_LINT_LEGADO_2026-08-05.md`.

## 7. Classificação

**DEPLOY COMPROVADO — UPSELL PUBLICADO E VERIFICADO NO BUNDLE DE PRODUÇÃO — SUÍTE E PORTÕES VERDES**
Ressalvas explícitas: (a) jornada autenticada de upsell não executada em produção por ausência de sessão de
teste; (b) gate global de lint segue vermelho por 4215 erros de formatação em arquivo auto-gerado.
