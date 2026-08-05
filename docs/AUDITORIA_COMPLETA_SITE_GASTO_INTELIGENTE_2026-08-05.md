# AUDITORIA COMPLETA — SITE GASTO INTELIGENTE

**Data:** 2026-08-05
**Escopo:** auditoria read-only, não destrutiva, baseada em código real, banco oficial, ambiente publicado e execução integral de testes.
**Nenhuma alteração de código, schema, dados, configuração ou publicação foi realizada nesta auditoria.**

---

## 1. VEREDITO EXECUTIVO

**Classificação geral: B — APTO PARA OPERAÇÃO COMERCIAL, COM RESSALVAS NÃO BLOQUEANTES.**

| Dimensão | Status | Nota |
|---|---|---|
| Integridade da build / tipos | ✅ Verde | `tsc --noEmit` sem erros; build Nitro OK (1m49s) |
| Suíte de testes | ✅ Verde | 135 arquivos, 2330 pass, 0 fail, 0 errors, 9 skip (2 execuções idênticas) |
| Segurança de banco (RLS) | ✅ Verde | 76 tabelas públicas, 0 sem RLS, 0 policy para `anon`, 0 policy `USING(true)` para dados de usuário |
| Segurança de endpoints | ✅ Verde | nenhuma escrita ou leitura de dado privado sem autenticação/HMAC |
| Integridade de cobrança | ✅ Verde | preço resolvido só no servidor; webhook com HMAC; idempotência; validação de valor contra provedor |
| Dependências | ✅ Verde | 0 vulnerabilidades high/critical |
| Ambiente publicado | ✅ Verde | deploy ativo, HSTS, rotas públicas 200, rotas privadas redirecionam para `/login` |
| Cabeçalhos de segurança HTTP | ⚠️ Parcial | falta CSP, `X-Frame-Options`/`frame-ancestors` e `Permissions-Policy` |
| Dívida de lint | ⚠️ Alta em volume, baixa em risco | 4334 erros, 4215 (97,3%) de Prettier em arquivo autogerado |
| WhatsApp | ⏸️ Desligado por design | `global_enabled=false`, `inbound=false`, `outbound=false`; 3 templates Meta em `pending` |
| Cobertura de validação autenticada em produção | ⚠️ Não comprovável | ambiente sem sessão de teste (`signed_out`) — ver §11 |

---

## 2. INVENTÁRIO DO PROJETO (evidência)

| Item | Valor | Fonte |
|---|---|---|
| Framework | TanStack Start v1.167.14 / React 19.2.0 / Vite 7.3.1 / Nitro 3.0.260603-beta | `package.json` |
| Rotas de aplicação | 130 arquivos em `src/routes` | `ls src/routes` |
| Endpoints HTTP | 20 arquivos em `src/routes/api` | `ls src/routes/api` |
| Lógica de servidor | 95 arquivos em `src/server` | `ls src/server` |
| Migrations | 158 | `ls supabase/migrations` |
| Arquivos de teste (unit/integration) | 136 (135 executados; `tests/e2e` excluído por design) | `scripts/run-test-suite.ts` |
| Tamanho da build cliente | 30 MB `dist`; maior chunk `main-BqOErm_8.js` = 1,92 MB | `du`/`find dist` |

---

## 3. AMBIENTE PUBLICADO (evidência direta)

```
x-deployment-id: 437b9b60d3ca1d52628ae524716682b579a529d94b9929eab82444f8fb697821
cache-control: no-cache, must-revalidate, max-age=0
strict-transport-security: max-age=31536000; includeSubDomains
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
server: cloudflare
```

**Status HTTP por rota (produção, `https://gastointeligente.com.br`):**

| Rota | HTTP | Comportamento real (navegador) |
|---|---|---|
| `/` | 200 | H1 “Controle suas finanças com mais clareza, inteligência e praticidade.” — 0 erros de console |
| `/login` | 200 | H1 “Bem-vindo de volta” — 0 erros de console |
| `/cadastro`, `/termos`, `/privacidade`, `/lgpd`, `/status`, `/recuperar-senha` | 200 | públicas, operacionais |
| `/resumo` | 200 (shell) | **redireciona para `/login`**; um `401` de server function aparece no console (fail-closed correto) |
| `/meu-plano` | 200 (shell) | **redireciona para `/login`**, sem erros |
| `/gastos`, `/admin` | 200 (shell) | shell SPA servido; conteúdo protegido por gate de sessão + RLS |

**Interpretação honesta:** rotas privadas devolvem `200` porque o shell é servido antes do gate de sessão no cliente. Não há vazamento de dados (RLS + `401` server-side), mas essas URLs são rastreáveis por buscadores — ver Achado **P2-01**.

`robots.txt`: `User-agent: * / Allow: /` + `Sitemap: .../sitemap.xml`. `sitemap.xml` presente e válido (`/`, `/status`, `/cadastro`, `/termos`, …).

---

## 4. BANCO DE DADOS — SEGURANÇA (evidência SQL)

| Verificação | Resultado |
|---|---|
| Tabelas no schema `public` | 76 |
| Tabelas **sem** RLS | **0 linhas** |
| Policies concedidas a `anon` | **0 linhas** |
| Policies com `USING(true)`/`WITH CHECK(true)` | 4, todas legítimas: `economic_indicators` (SELECT/authenticated), `brand_assets` (SELECT/authenticated), `whatsapp_notification_templates` (SELECT/authenticated), `whatsapp_meta_templates` (ALL/service_role) |
| Funções `SECURITY DEFINER` sem `search_path` fixo | **0 linhas** |
| `has_role` / `is_owner` executáveis por `anon` | Não (revogado em migration anterior; reconfirmado) |

**Volumetria real (produção):** `profiles` 23 · `user_plans` 23 · `gastos` 133 · `receitas` 123 · `cartoes` 5 · `contas_a_pagar` 19 · `contas_a_receber` 2 · `subscription_payments` 5 · `payment_checkout_sessions` 1 · `whatsapp_messages` 269 · `whatsapp_links` 1 · `vault_entries` 14 · `user_roles` 18 · `user_communication_preferences` 0.

**Distribuição de planos:** `free_ads/ativo` 21 · `pessoal_manual/ativo` 1 · `pessoal_manual/aguardando_pagamento` 1. Consistente com o rollout `free_ads` documentado.

**Security scan (Lovable/Supabase):** 4 findings, todos nível **warn**, 0 critical/high:
1. `SECURITY DEFINER` executável por `anon` (lint genérico 0028) — mitigado nas funções sensíveis; ver P2-02.
2. `SECURITY DEFINER` executável por `authenticated` (lint 0029) — esperado, funções são o mecanismo de autorização.
3. `contas_a_pagar.connected_select_contas_a_pagar` usa `can_admin_account()` enquanto `gastos`/`receitas`/`bancos` usam `can_view_account()` — **inconsistência de modelo, fail-closed (mais restritivo)**. P2-03.
4. `user_communication_preferences` sem policy de DELETE — lacuna funcional, fail-closed. P3-01.

**Dependências:** 0 vulnerabilidades high/critical (`seroval` 1.5.6 mantido).

---

## 5. ENDPOINTS HTTP — AUTENTICAÇÃO (evidência por arquivo)

Nenhum endpoint executa escrita ou devolve dado privado sem autenticação. Três grupos:

**A) Bearer token Supabase (401 se ausente)** — `checkout.create.ts:37-51`, `checkout.verify.ts:33-54`, `import-conta.ts:104`, `import-conta-pdf.ts:268`, `import-extrato.ts:675`, `import-fatura-imagem.ts:99`, `import-fatura-pdf.ts:258`, `import-investimentos.ts:377`, `ocr-gasto.ts:27`, `mercado-flyer-ocr.ts:725`, `mercado-joanin-import.ts:311`, `integrations.mercadopago.$action.ts:23`, `integrations.mercadopago.connect.ts:18`. Vários somam `ensurePremiumFeatureAccess` + rate limit por usuário (ex.: `import-conta.ts:106-114`).

**B) HMAC / state assinado (máquina-a-máquina)** — `public.hooks.whatsapp-dispatcher.ts:44-56` e `public.hooks.whatsapp-contas-lembretes-generate.ts:33-54` (HMAC-SHA256 do corpo cru + `timingSafeEqual`, `WHATSAPP_DISPATCHER_SECRET`); `public.webhooks.mercadopago.ts:167-186` (assinatura verificada **antes** de qualquer leitura/escrita, 503 se secret ausente); `public.whatsapp.expense.ts:425-439` (verify token com `timingSafeEqual`; POST com `verifyMetaSignature`/`WHATSAPP_APP_SECRET`); `integrations.mercadopago.callback.ts:14-38` (state HMAC, `mercado-pago-integration.server.ts:43-56`).

**C) Público por design, sem PII** — `health.ts` (liveness) e `economic-radar.ts` (dado público de mercado, read-only).

---

## 6. INTEGRIDADE DE COBRANÇA (Mercado Pago)

| Controle | Evidência | Status |
|---|---|---|
| Preço nunca vem do cliente | `checkout.create.ts:71-74` → `resolveCatalogOffer`; catálogo servidor `mercadopago-plan-catalog.server.ts:22-28,60-92` | ✅ |
| Idempotência | `X-Idempotency-Key` derivado do `session.id` (`checkout.create.ts:195,202,296`); `idempotencyKey` de evento (`public.webhooks.mercadopago.ts:222`); RPC trata `duplicate_event`/`stale_event_skipped` (`:474-488`) | ✅ |
| HMAC do webhook antes de escrever | `public.webhooks.mercadopago.ts:167-186`; fail-closed 503 sem secret (`:96-102`) | ✅ |
| Valor/plano/moeda conferidos contra o provedor | `validateOfferAgainstProvider` (`mercadopago-plan-catalog.server.ts:106-128`); mismatch ⇒ 409, plano **não** ativado (`:259-294`) | ✅ |
| Retorno forjado do navegador ativa plano? | **Não.** `?status=success` é só UI; ativação só via webhook assinado ou `checkout.verify.ts:79-131`, que consulta a API da MP com token do servidor e restringe a linha ao `user_id` do chamador (`:71-73`) | ✅ |
| Ambiente sandbox vs produção isolado | `resolveCheckoutSession` falha com `environment_mismatch`/`invalid_reference` (`:298-313`) | ✅ |

**Catálogo comercial vs catálogo de cobrança — sem divergência de preço:**

| Plano | UI (`src/lib/plans.ts`) | Cobrança (`mercadopago-plan-catalog.server.ts`) |
|---|---|---|
| `pessoal_manual` | Controle Simples Pessoal — R$ 25,00 (deprecado, invisível, sem novas assinaturas) | 2500¢, `allowNew:false` |
| `pessoal_premium` | Controle Completo Pessoal — R$ 50,00 | 5000¢ |
| `mei_essencial` | Essencial para MEI — R$ 39,90 | 3990¢ |
| `mei_inteligente` | MEI Completo — R$ 90,00 | 9000¢ |
| `empresa` | Empresa — R$ 180,00 | 18000¢ |

Landing (`src/components/landing/PublicLanding.tsx:3378-3404`) e `meu-plano.tsx:716,794` renderizam do **mesmo** `COMMERCIAL_PLANS`. Ressalva: os *benefícios* na landing passam por i18n (`plans.highlights.${tier}`) com fallback ao código — texto pode divergir, preço não. Ver P3-02.

---

## 7. TESTES (execução integral, duas vezes)

Runner canônico `scripts/run-test-suite.ts` (um processo por arquivo, descoberta recursiva de `.test.ts`/`.test.tsx`, `tests/e2e` excluído).

| Execução | arquivos | pass | fail | skip | errors |
|---|---|---|---|---|---|
| #1 | 135 | 2330 | 0 | 9 | 0 |
| #2 | 135 | 2330 | 0 | 9 | 0 |

**Determinístico.** Os 9 skips, justificados por evidência:

| Arquivo | Skips | Justificativa |
|---|---|---|
| `tests/connected-accounts-viewer-policy-sec-ca-01b.test.ts` | 7 | `it.todo` — validação RLS ponta-a-ponta exige JWT de QA (`hasQaJwt`) inexistente no ambiente; lacuna mantida **visível** por design (`:162-171`) |
| `tests/whatsapp-contas-editar.test.ts` | 2 | escopos `SINGLE` e `FUTURE_PENDING` de edição de recorrência ainda não implementados no handler (`:352,367`) |

---

## 8. PORTÕES TÉCNICOS

| Portão | Resultado |
|---|---|
| `tsc --noEmit` | ✅ 0 erros |
| `bun run build` | ✅ exit 0, 1m49s, Nitro OK |
| Suíte | ✅ 2330 pass / 0 fail (2×) |
| Dependency scan | ✅ 0 high/critical |
| Security scan | ⚠️ 4 warn, 0 critical/high |
| Lint global | ⚠️ 4334 erros |

**Lint por regra:** `prettier/prettier` 4215 · `@typescript-eslint/no-explicit-any` 80 · `no-useless-escape` 32 · `no-control-regex` 4 · `no-empty` 2 · `no-unused-expressions` 1.
**Lint por arquivo (top):** `src/integrations/supabase/types.ts` 4215 (**autogerado — não editável**) · `src/routes/api/import-extrato.ts` 19 · `src/lib/admin.functions.ts` 12 · `src/lib/recorrencias.ts` 10 · `src/routes/admin.tsx` 7.
Ou seja: **97,3% do débito é formatação em arquivo gerado**; o débito real editável é de ~119 erros. Plano em `docs/PLANO_CORRECAO_LINT_LEGADO_2026-08-05.md`.

---

## 9. WHATSAPP — ESTADO REAL

| Item | Valor |
|---|---|
| `whatsapp_runtime_config.global_enabled` | `false` |
| `inbound_enabled` | `false` |
| `outbound_enabled` | `false` |
| Templates Meta cadastrados | 3 (`gi_conta_atrasada_v1`, `gi_conta_vencendo_amanha_v1`, `gi_conta_vencendo_hoje_v1`), todos `pt_BR`, `status=pending`, `active=false`, com `provider_template_id` |
| Vínculos ativos | 1 registro em `whatsapp_links` |
| Mensagens históricas | 269 em `whatsapp_messages` |

**Conclusão:** o canal está **desligado e fail-closed**. Nenhuma liberação a usuários é possível sem (a) aprovação dos 3 templates pela Meta e (b) ativação explícita das flags de runtime. Entitlement continua restrito a planos pagos + allowlist beta, conforme regra de negócio vigente.

---

## 10. ACHADOS (priorizados)

### P1 — Corrigir antes de escalar tráfego pago
- **P1-01 — Ausência de CSP e cabeçalhos anti-clickjacking.** Produção não envia `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors` nem `Permissions-Policy`; nenhuma definição no código (`rg` em `src`, `public`, `wrangler.jsonc`, `vite.config.ts` → 0 resultados). Impacto: app financeiro sujeito a clickjacking e a injeção de terceiros via GTM. Risco moderado, correção barata.
- **P1-02 — Chunk inicial de 1,92 MB (`main-BqOErm_8.js`).** Impacto direto em LCP/INP no mobile 4G, que é o público-alvo. Recomenda-se split de rotas pesadas (`ImportInvestimentosFlow` 515 KB, `PieChart` 385 KB já separados; o `main` ainda concentra demais).

### P2 — Corrigir em janela planejada
- **P2-01 — Rotas privadas indexáveis.** `robots.txt` permite tudo e `/resumo`, `/gastos`, `/meu-plano`, `/admin` respondem 200. Sem vazamento de dados, mas gera URLs privadas no índice e diluição de SEO. Recomendação: `Disallow` explícito das áreas autenticadas + `noindex` nessas rotas.
- **P2-02 — `SECURITY DEFINER` executável por `anon` (lint 0028).** As funções críticas (`has_role`, `is_owner`) já tiveram `EXECUTE` revogado; resta varredura completa das demais para revogar o que não precisa ser público.
- **P2-03 — Modelo de acesso compartilhado inconsistente.** `contas_a_pagar` exige `can_admin_account()` enquanto `gastos`/`receitas`/`bancos` aceitam `can_view_account()`. Fail-closed, mas o usuário “view” vê gastos e não vê contas a pagar da mesma conta — inconsistência de produto a decidir explicitamente.
- **P2-04 — Duplicação de `getUserFromRequest`.** `checkout.create.ts` e `checkout.verify.ts` reimplementam o helper em vez de importar `src/server/api-auth.ts`. Hoje equivalentes; risco de divergência futura em código de cobrança.

### P3 — Higiene
- **P3-01 —** `user_communication_preferences` sem policy de DELETE (lacuna funcional, fail-closed).
- **P3-02 —** Benefícios de plano na landing vêm de i18n com fallback ao código; texto pode divergir de `plans.ts` (preço não pode).
- **P3-03 —** 9 skips legítimos, porém 2 representam **funcionalidade ausente** (edição de recorrência `SINGLE`/`FUTURE_PENDING` no WhatsApp) e 7 representam **cobertura ausente** (RLS de contas conectadas sem JWT de QA).
- **P3-04 —** Débito de lint editável (~119 erros) concentrado em `import-extrato.ts`, `admin.functions.ts`, `recorrencias.ts`.

---

## 11. LIMITES DESTA AUDITORIA (o que NÃO foi possível validar)

Declarado explicitamente, sem inferência:

1. **Jornada autenticada em produção não executada.** `LOVABLE_BROWSER_AUTH_STATUS=signed_out`: não existe sessão de teste no ambiente publicado. Portanto **não** foram validados manualmente em produção: dashboard `/resumo` com dados, criação/edição de gastos, receitas, cartões, faturas, metas, mercado, investimentos, cofre pessoal, contas conectadas, e a jornada de upsell (banner → recusa → snooze → modal). Essas áreas permanecem cobertas apenas por testes determinísticos (2330) e por verificação de RLS no banco.
2. **Checkout real de pagamento não executado.** Nenhuma compra foi feita; a integridade de cobrança foi verificada por leitura de código + evidência de schema/registros, não por transação real.
3. **WhatsApp ponta-a-ponta não exercitado** — canal desligado por design e templates `pending` na Meta.
4. **Cobertura de código (%) não medida** — o runner reporta pass/fail por arquivo, não cobertura de linhas.
5. **Performance real (Core Web Vitals de campo) não medida** — só o tamanho estático dos bundles.
6. **Ambiente Android nativo inexistente no workspace** — reconfirmado; apenas bridges em `src/lib`.

---

## 12. RECOMENDAÇÃO FINAL

O site está **tecnicamente estável e comercialmente operável**: build verde, suíte determinística, RLS íntegro em 76 tabelas, cobrança à prova de manipulação de preço e nenhum endpoint aberto. As ressalvas relevantes são **cabeçalhos de segurança HTTP (P1-01)**, **peso do bundle inicial (P1-02)** e **indexação de rotas privadas (P2-01)** — nenhuma delas bloqueia venda, todas afetam robustez e conversão.

Documentos complementares:
- `docs/MATRIZ_FUNCIONALIDADES_GASTO_INTELIGENTE_2026-08-05.md`
- `docs/PLANO_ACAO_POS_AUDITORIA_2026-08-05.md`
