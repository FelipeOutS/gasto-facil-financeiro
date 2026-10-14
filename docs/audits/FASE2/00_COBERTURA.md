# FASE 2 — 00 Cobertura (HEAD `f22e1eab7f9ca93be780b71bfeba71a0ab59c707`)

Inventário: os mesmos 111 arquivos e 46557 linhas da 1ª rodada (recontado com `wc -l` no HEAD; nenhum arquivo novo, nenhuma linha alterada no inventário).

'Revisado integral' significa que o revisor do pacote declarou a leitura de 1 até o fim do arquivo (EOF) em blocos consecutivos. Isso **não foi provado de forma independente** pelo consolidador.

| Status | Arquivos | Linhas | % |
|---|---:|---:|---:|
| Revisado integralmente nesta rodada | 39 | 25284 | 54.3% |
| Integral autodeclarado só na 1ª rodada | 70 | 14511 | 31.2% |
| Parcial | 1 | 6185 | 13.3% |
| Não lido | 1 | 577 | 1.2% |

**Fora do inventário, lidos integralmente nesta rodada:**
- `src/server/cartao-fatura.server.ts` (802 linhas) e `contas-vencimento.server.ts` (217), no pacote 3;
- `expense-button-token.server.ts` (88) e `src/lib/whatsappParser.ts` (418), no pacote 2;
- `whatsapp-runtime-admin.functions.ts`, `whatsapp-templates-admin.functions.ts` e `admin-master.server.ts`, no pacote 5.

**Fora do inventário, PARCIAL:** `src/lib/store.ts`, 3.793 de 5.732 linhas (faltam as linhas 2701–4299 e 4912–5249).

**SQL (inventário separado):**
- `supabase/migrations`: 37 arquivos citam whatsapp_/agenda_. Lido integralmente: 1 (`20261004130000`). Amostrados por grep: 3. Não lidos: 33.
- `drizzle/migrations`: 5 arquivos citam whatsapp_/agenda_, só amostrados.
- Candidatos lidos integralmente: F2, UNDO, F4 e Compras. O candidato canário não foi lido.

| Arquivo | Linhas | Intervalo verificado | Status |
|---|---:|---|---|
| `src/lib/agenda.functions.ts` | 120 | — | integral autodeclarado (1ª rodada) |
| `src/routes/api/public.hooks.whatsapp-contas-lembretes-generate.ts` | 89 | — | integral autodeclarado (1ª rodada) |
| `src/routes/api/public.hooks.whatsapp-dispatcher.ts` | 356 | — | integral autodeclarado (1ª rodada) |
| `src/routes/api/public.hooks.whatsapp-proactive-generate.ts` | 41 | — | integral autodeclarado (1ª rodada) |
| `src/routes/api/public.whatsapp.expense.ts` | 1271 | 1–1271 | REVISADO INTEGRAL (2ª rodada, pacote 01) |
| `src/server/agenda-confirm-token.server.ts` | 44 | — | integral autodeclarado (1ª rodada) |
| `src/server/agenda.server.ts` | 562 | — | integral autodeclarado (1ª rodada) |
| `src/server/ocr-comprovante.server.ts` | 311 | — | integral autodeclarado (1ª rodada) |
| `src/server/shopping/capacidade-compra.ts` | 141 | — | integral autodeclarado (1ª rodada) |
| `src/server/shopping/finance-snapshot.ts` | 149 | — | integral autodeclarado (1ª rodada) |
| `src/server/shopping/offer-specs.ts` | 61 | — | integral autodeclarado (1ª rodada) |
| `src/server/shopping/serpapi-shopping.ts` | 124 | — | integral autodeclarado (1ª rodada) |
| `src/server/shopping/shopping-assistant.ts` | 96 | — | integral autodeclarado (1ª rodada) |
| `src/server/shopping/shopping-context.ts` | 69 | — | integral autodeclarado (1ª rodada) |
| `src/server/shopping/shopping-followup-claim.server.ts` | 18 | — | integral autodeclarado (1ª rodada) |
| `src/server/shopping/shopping-followup.ts` | 118 | — | integral autodeclarado (1ª rodada) |
| `src/server/shopping/shopping-intent.ts` | 50 | — | integral autodeclarado (1ª rodada) |
| `src/server/shopping/shopping-quota-db.ts` | 43 | — | integral autodeclarado (1ª rodada) |
| `src/server/shopping/shopping-quota.ts` | 61 | — | integral autodeclarado (1ª rodada) |
| `src/server/shopping/whatsapp-shopping.server.ts` | 150 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-agenda.server.ts` | 577 | — | NÃO LIDO |
| `src/server/whatsapp-alert-preferences.server.ts` | 55 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-approved-template-resolver.server.ts` | 134 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-audio-duration.server.ts` | 430 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-audio-lote.ts` | 238 | 1–238 | REVISADO INTEGRAL (2ª rodada, pacote 04) |
| `src/server/whatsapp-audio.server.ts` | 237 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-authz.server.ts` | 151 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-beta.server.ts` | 67 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-boleto-banco.ts` | 60 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-boleto-intents.server.ts` | 1479 | 1–1479 | REVISADO INTEGRAL (2ª rodada, pacote 04) |
| `src/server/whatsapp-boleto-ocr-cache.server.ts` | 74 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-boleto-ocr.server.ts` | 270 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-boleto-parser.ts` | 335 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-boleto-secret.server.ts` | 59 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-c11-gates.server.ts` | 479 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-callback-quota-reconcile.server.ts` | 167 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-canary-notification.server.ts` | 270 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-cartao-cadastro.server.ts` | 549 | 1–549 | REVISADO INTEGRAL (2ª rodada, pacote 03) |
| `src/server/whatsapp-cartao-flow.ts` | 167 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-cartao-messages.ts` | 115 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-comprovantes.server.ts` | 1565 | 1–1565 | REVISADO INTEGRAL (2ª rodada, pacote 02+04) |
| `src/server/whatsapp-consultas-especificas.server.ts` | 634 | 1–634 | REVISADO INTEGRAL (2ª rodada, pacote 02) |
| `src/server/whatsapp-consultas.server.ts` | 1483 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-contas-criar.server.ts` | 1306 | 1–1306 | REVISADO INTEGRAL (2ª rodada, pacote 03) |
| `src/server/whatsapp-contas-editar.server.ts` | 1501 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-contas-lembretes.server.ts` | 525 | 1–525 | REVISADO INTEGRAL (2ª rodada, pacote 03) |
| `src/server/whatsapp-contas-pagar.server.ts` | 955 | 1–955 | REVISADO INTEGRAL (2ª rodada, pacote 03) |
| `src/server/whatsapp-contas.server.ts` | 629 | 1–629 | REVISADO INTEGRAL (2ª rodada, pacote 03) |
| `src/server/whatsapp-cycle-resolver.server.ts` | 97 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-dispatcher-outbound.server.ts` | 262 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-entitlement.server.ts` | 262 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-fatura-escolha.server.ts` | 174 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-faturas.server.ts` | 1362 | 1–1362 | REVISADO INTEGRAL (2ª rodada, pacote 03) |
| `src/server/whatsapp-favorecidos.server.ts` | 153 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-finance-brief.server.ts` | 188 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-financial-idempotency.server.ts` | 18 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-financial-quota-gate.server.ts` | 398 | 1–398 | REVISADO INTEGRAL (2ª rodada, pacote 05) |
| `src/server/whatsapp-graph-version.server.ts` | 156 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-interactive.server.ts` | 538 | 1–538 | REVISADO INTEGRAL (2ª rodada, pacote 02) |
| `src/server/whatsapp-limites.server.ts` | 439 | 1–439 | REVISADO INTEGRAL (2ª rodada, pacote 03) |
| `src/server/whatsapp-link-verification.server.ts` | 94 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-media-attachment.ts` | 37 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-media-sanitize.server.ts` | 57 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-media-validation.server.ts` | 80 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-merchant-memory.server.ts` | 268 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-mes-nomeado.ts` | 234 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-messages.ts` | 987 | 1–987 | REVISADO INTEGRAL (2ª rodada, pacote 01) |
| `src/server/whatsapp-meta-status-callbacks.server.ts` | 1179 | 1–1179 | REVISADO INTEGRAL (2ª rodada, pacote 01) |
| `src/server/whatsapp-meta-template-management.server.ts` | 433 | 1–433 | REVISADO INTEGRAL (2ª rodada, pacote 05) |
| `src/server/whatsapp-meta-template-mapping.server.ts` | 78 | 1–78 | REVISADO INTEGRAL (2ª rodada, pacote 05) |
| `src/server/whatsapp-meta-template-placeholders.server.ts` | 156 | 1–156 | REVISADO INTEGRAL (2ª rodada, pacote 05) |
| `src/server/whatsapp-meta-templates-catalog.server.ts` | 107 | 1–107 | REVISADO INTEGRAL (2ª rodada, pacote 05) |
| `src/server/whatsapp-meta-template-submission.server.ts` | 114 | 1–114 | REVISADO INTEGRAL (2ª rodada, pacote 05) |
| `src/server/whatsapp-meta-template-sync.server.ts` | 216 | 1–216 | REVISADO INTEGRAL (2ª rodada, pacote 05) |
| `src/server/whatsapp-meta-transport.server.ts` | 706 | 1–706 | REVISADO INTEGRAL (2ª rodada, pacote 01) |
| `src/server/whatsapp-notification-attempts.server.ts` | 488 | 1–488 | REVISADO INTEGRAL (2ª rodada, pacote 01) |
| `src/server/whatsapp-notification-gates.server.ts` | 337 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-notifications.server.ts` | 757 | 1–757 | REVISADO INTEGRAL (2ª rodada, pacote 01) |
| `src/server/whatsapp-optout.server.ts` | 272 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-outbound-adapter.server.ts` | 840 | 1–840 | REVISADO INTEGRAL (2ª rodada, pacote 01) |
| `src/server/whatsapp-outbound-gates.server.ts` | 114 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-outbound-log.server.ts` | 241 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-outbound-quota-wire.server.ts` | 344 | 1–344 | REVISADO INTEGRAL (2ª rodada, pacote 01) |
| `src/server/whatsapp-pagar-pessoa-flow.server.ts` | 1788 | 1–1788 | REVISADO INTEGRAL (2ª rodada, pacote 04) |
| `src/server/whatsapp-parcelamento.server.ts` | 1383 | 1–1383 | REVISADO INTEGRAL (2ª rodada, pacote 02) |
| `src/server/whatsapp-pdf-text-extract.server.ts` | 224 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-pdf-validation.server.ts` | 86 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-pix-intents.server.ts` | 523 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-pix-parser.ts` | 767 | 1–767 | REVISADO INTEGRAL (2ª rodada, pacote 04) |
| `src/server/whatsapp-pix-reveal-token.server.ts` | 172 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-pix-secret.server.ts` | 170 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-planning.server.ts` | 418 | 1–418 | REVISADO INTEGRAL (2ª rodada, pacote 02) |
| `src/server/whatsapp-postlaunch.server.ts` | 362 | 1–362 | REVISADO INTEGRAL (2ª rodada, pacote 02) |
| `src/server/whatsapp-proactive-alerts.server.ts` | 177 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-query-guard.server.ts` | 243 | 1–243 | REVISADO INTEGRAL (2ª rodada, pacote 05) |
| `src/server/whatsapp-quota-admin.server.ts` | 364 | 1–364 | REVISADO INTEGRAL (2ª rodada, pacote 05) |
| `src/server/whatsapp-quota.server.ts` | 396 | 1–396 | REVISADO INTEGRAL (2ª rodada, pacote 05) |
| `src/server/whatsapp-receitas.server.ts` | 702 | 1–702 | REVISADO INTEGRAL (2ª rodada, pacote 02) |
| `src/server/whatsapp-research-core.ts` | 165 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-research-mvp.ts` | 149 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-research-provider.server.ts` | 109 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-research.server.ts` | 131 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-rollout.server.ts` | 101 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-runtime-config.server.ts` | 174 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-sent-audit.server.ts` | 30 | 1–30 | REVISADO INTEGRAL (2ª rodada, pacote 01) |
| `src/server/whatsapp.server.ts` | 6185 | — | PARCIAL (não relido na 2ª; ~parcial na 1ª) |
| `src/server/whatsapp-short-context.server.ts` | 379 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-transcription.server.ts` | 135 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-transport-error-sanitizer.server.ts` | 115 | — | integral autodeclarado (1ª rodada) |
| `src/server/whatsapp-voice-number-normalizer.server.ts` | 436 | 1–436 | REVISADO INTEGRAL (2ª rodada, pacote 02) |
| `src/server/whatsapp-wikimedia.server.ts` | 102 | 1–102 | REVISADO INTEGRAL (2ª rodada, pacote 05) |
