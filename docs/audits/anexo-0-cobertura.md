# Anexo 0 — Reconciliação de cobertura de leitura

Método: script lê as tabelas de cobertura dos anexos 1–5. Status vem da célula de status (Integral/Parcial/Não lido). **Quando anexos divergem, vale o status MAIS BAIXO** (conservador). Linhas = `wc -l` no commit auditado. **'Integral' é autodeclarado pelo revisor de cada anexo; não houve prova independente linha a linha.**

Inventário: `_inventario_src.txt` — 111 arquivos, 46557 linhas (src/server/whatsapp*, agenda*, shopping/*, comprovante/ocr, rotas api whatsapp, src/lib/agenda*). SQL e testes ficam fora deste total (ver anexo 6).

| Status | Arquivos | Linhas | % |
|---|---:|---:|---:|
| Integral (autodeclarado) | 70 | 14511 | 31.2% |
| Parcial | 5 | 10457 | 22.5% |
| Não lido (declarado) | 18 | 12930 | 27.8% |
| Sem anexo (não citado) | 18 | 8659 | 18.6% |

## Por arquivo do inventário

| Arquivo | Linhas | Status |
|---|---:|---|
| `src/lib/agenda.functions.ts` | 120 | integral |
| `src/routes/api/public.hooks.whatsapp-contas-lembretes-generate.ts` | 89 | integral |
| `src/routes/api/public.hooks.whatsapp-dispatcher.ts` | 356 | integral |
| `src/routes/api/public.hooks.whatsapp-proactive-generate.ts` | 41 | integral |
| `src/routes/api/public.whatsapp.expense.ts` | 1271 | nao_lido |
| `src/server/agenda-confirm-token.server.ts` | 44 | integral |
| `src/server/agenda.server.ts` | 562 | integral |
| `src/server/ocr-comprovante.server.ts` | 311 | integral |
| `src/server/shopping/capacidade-compra.ts` | 141 | integral |
| `src/server/shopping/finance-snapshot.ts` | 149 | integral |
| `src/server/shopping/offer-specs.ts` | 61 | integral |
| `src/server/shopping/serpapi-shopping.ts` | 124 | integral |
| `src/server/shopping/shopping-assistant.ts` | 96 | integral |
| `src/server/shopping/shopping-context.ts` | 69 | integral |
| `src/server/shopping/shopping-followup-claim.server.ts` | 18 | integral |
| `src/server/shopping/shopping-followup.ts` | 118 | integral |
| `src/server/shopping/shopping-intent.ts` | 50 | integral |
| `src/server/shopping/shopping-quota-db.ts` | 43 | integral |
| `src/server/shopping/shopping-quota.ts` | 61 | integral |
| `src/server/shopping/whatsapp-shopping.server.ts` | 150 | integral |
| `src/server/whatsapp-agenda.server.ts` | 577 | nao_lido |
| `src/server/whatsapp-alert-preferences.server.ts` | 55 | integral |
| `src/server/whatsapp-approved-template-resolver.server.ts` | 134 | integral |
| `src/server/whatsapp-audio-duration.server.ts` | 430 | integral |
| `src/server/whatsapp-audio-lote.ts` | 238 | nao_lido |
| `src/server/whatsapp-audio.server.ts` | 237 | integral |
| `src/server/whatsapp-authz.server.ts` | 151 | integral |
| `src/server/whatsapp-beta.server.ts` | 67 | integral |
| `src/server/whatsapp-boleto-banco.ts` | 60 | integral |
| `src/server/whatsapp-boleto-intents.server.ts` | 1479 | nao_lido |
| `src/server/whatsapp-boleto-ocr-cache.server.ts` | 74 | integral |
| `src/server/whatsapp-boleto-ocr.server.ts` | 270 | integral |
| `src/server/whatsapp-boleto-parser.ts` | 335 | integral |
| `src/server/whatsapp-boleto-secret.server.ts` | 59 | integral |
| `src/server/whatsapp-c11-gates.server.ts` | 479 | integral |
| `src/server/whatsapp-callback-quota-reconcile.server.ts` | 167 | integral |
| `src/server/whatsapp-canary-notification.server.ts` | 270 | integral |
| `src/server/whatsapp-cartao-cadastro.server.ts` | 549 | nao_lido |
| `src/server/whatsapp-cartao-flow.ts` | 167 | integral |
| `src/server/whatsapp-cartao-messages.ts` | 115 | integral |
| `src/server/whatsapp-comprovantes.server.ts` | 1565 | nao_lido |
| `src/server/whatsapp-consultas-especificas.server.ts` | 634 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-consultas.server.ts` | 1483 | integral |
| `src/server/whatsapp-contas-criar.server.ts` | 1306 | nao_lido |
| `src/server/whatsapp-contas-editar.server.ts` | 1501 | integral |
| `src/server/whatsapp-contas-lembretes.server.ts` | 525 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-contas-pagar.server.ts` | 955 | nao_lido |
| `src/server/whatsapp-contas.server.ts` | 629 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-cycle-resolver.server.ts` | 97 | integral |
| `src/server/whatsapp-dispatcher-outbound.server.ts` | 262 | integral |
| `src/server/whatsapp-entitlement.server.ts` | 262 | integral |
| `src/server/whatsapp-fatura-escolha.server.ts` | 174 | integral |
| `src/server/whatsapp-faturas.server.ts` | 1362 | nao_lido |
| `src/server/whatsapp-favorecidos.server.ts` | 153 | integral |
| `src/server/whatsapp-finance-brief.server.ts` | 188 | integral |
| `src/server/whatsapp-financial-idempotency.server.ts` | 18 | integral |
| `src/server/whatsapp-financial-quota-gate.server.ts` | 398 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-graph-version.server.ts` | 156 | integral |
| `src/server/whatsapp-interactive.server.ts` | 538 | parcial |
| `src/server/whatsapp-limites.server.ts` | 439 | nao_lido |
| `src/server/whatsapp-link-verification.server.ts` | 94 | integral |
| `src/server/whatsapp-media-attachment.ts` | 37 | integral |
| `src/server/whatsapp-media-sanitize.server.ts` | 57 | integral |
| `src/server/whatsapp-media-validation.server.ts` | 80 | integral |
| `src/server/whatsapp-merchant-memory.server.ts` | 268 | integral |
| `src/server/whatsapp-mes-nomeado.ts` | 234 | integral |
| `src/server/whatsapp-messages.ts` | 987 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-meta-status-callbacks.server.ts` | 1179 | parcial |
| `src/server/whatsapp-meta-template-management.server.ts` | 433 | nao_lido |
| `src/server/whatsapp-meta-template-mapping.server.ts` | 78 | nao_lido |
| `src/server/whatsapp-meta-template-placeholders.server.ts` | 156 | nao_lido |
| `src/server/whatsapp-meta-template-submission.server.ts` | 114 | nao_lido |
| `src/server/whatsapp-meta-template-sync.server.ts` | 216 | nao_lido |
| `src/server/whatsapp-meta-templates-catalog.server.ts` | 107 | nao_lido |
| `src/server/whatsapp-meta-transport.server.ts` | 706 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-notification-attempts.server.ts` | 488 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-notification-gates.server.ts` | 337 | integral |
| `src/server/whatsapp-notifications.server.ts` | 757 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-optout.server.ts` | 272 | integral |
| `src/server/whatsapp-outbound-adapter.server.ts` | 840 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-outbound-gates.server.ts` | 114 | integral |
| `src/server/whatsapp-outbound-log.server.ts` | 241 | integral |
| `src/server/whatsapp-outbound-quota-wire.server.ts` | 344 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-pagar-pessoa-flow.server.ts` | 1788 | parcial |
| `src/server/whatsapp-parcelamento.server.ts` | 1383 | nao_lido |
| `src/server/whatsapp-pdf-text-extract.server.ts` | 224 | integral |
| `src/server/whatsapp-pdf-validation.server.ts` | 86 | integral |
| `src/server/whatsapp-pix-intents.server.ts` | 523 | integral |
| `src/server/whatsapp-pix-parser.ts` | 767 | parcial |
| `src/server/whatsapp-pix-reveal-token.server.ts` | 172 | integral |
| `src/server/whatsapp-pix-secret.server.ts` | 170 | integral |
| `src/server/whatsapp-planning.server.ts` | 418 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-postlaunch.server.ts` | 362 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-proactive-alerts.server.ts` | 177 | integral |
| `src/server/whatsapp-query-guard.server.ts` | 243 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-quota-admin.server.ts` | 364 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-quota.server.ts` | 396 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-receitas.server.ts` | 702 | nao_lido |
| `src/server/whatsapp-research-core.ts` | 165 | integral |
| `src/server/whatsapp-research-mvp.ts` | 149 | integral |
| `src/server/whatsapp-research-provider.server.ts` | 109 | integral |
| `src/server/whatsapp-research.server.ts` | 131 | integral |
| `src/server/whatsapp-rollout.server.ts` | 101 | integral |
| `src/server/whatsapp-runtime-config.server.ts` | 174 | integral |
| `src/server/whatsapp-sent-audit.server.ts` | 30 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-short-context.server.ts` | 379 | integral |
| `src/server/whatsapp-transcription.server.ts` | 135 | integral |
| `src/server/whatsapp-transport-error-sanitizer.server.ts` | 115 | integral |
| `src/server/whatsapp-voice-number-normalizer.server.ts` | 436 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp-wikimedia.server.ts` | 102 | NÃO LIDO (sem anexo) |
| `src/server/whatsapp.server.ts` | 6185 | parcial |

## Arquivos fora do inventário citados nos anexos

| Arquivo | Linhas | Status |
|---|---:|---|
| `docs/SHOPPING_PILOTO.md` | 15 | integral |
| `docs/migrations-candidate/gastos-delete-atomic-f4.sql` | 67 | integral |
| `docs/migrations-candidate/gastos-soft-delete-f2.sql` | 270 | integral |
| `docs/migrations-candidate/wa-c92-e1e-canary-template.sql` | 80 | nao_lido |
| `docs/migrations-candidate/whatsapp-shopping-quota.sql` | 174 | nao_lido |
| `docs/migrations-candidate/whatsapp-undo-soft-delete.sql` | 108 | integral |
| `scripts/serpapi-shopping-smoke.mjs` | 171 | nao_lido |
| `src/lib/agenda/buckets.ts` | 20 | integral |
| `src/lib/agenda/datetime.ts` | 284 | integral |
| `src/lib/agenda/intent.ts` | 197 | integral |
| `src/lib/agenda/recurrence.ts` | 87 | integral |
| `src/lib/mercado/nfce-fetch.functions.ts` | 230 | integral |
| `src/lib/mercado/nfce-html-parser.ts` | 273 | integral |
| `src/lib/mercado/nfce-items-parser.ts` | 371 | integral |
| `src/lib/mercado/nfce-parser.ts` | 206 | integral |
| `src/lib/nota/nfce-to-gasto.ts` | 87 | integral |
| `src/lib/nota/nfce-url-guard.ts` | 111 | integral |
| `src/lib/store.ts` | 5832 | parcial |
| `src/lib/whatsappParser.ts` | 410 | integral |
| `src/routes/api/ocr-gasto.ts` | 55 | integral |
| `src/server/api-auth.ts` | 149 | integral |
| `src/server/cartao-cadastro.server.ts` | 151 | integral |
| `src/server/cartao-fatura.server.ts` | 802 | nao_lido |
| `src/server/cartao-limite.server.ts` | 146 | integral |
| `src/server/cartao-parcelamento.server.ts` | 182 | integral |
| `src/server/contas-vencimento.server.ts` | 217 | nao_lido |
| `src/server/expense-button-token.server.ts` | 88 | integral |
| `src/server/rate-limit.server.ts` | 146 | integral |
| `src/server/whatsapp-boleto-*.ts/.server.ts` | 0 | nao_lido |
| `src/server/whatsapp-pix-*.ts/.server.ts` | 0 | nao_lido |
| `supabase/migrations/*` | 0 | parcial |
| `tests/nota-nfce-extracao.test.ts` | 73 | integral |
| `tests/sql/whatsapp-shopping-quota/00-stub.sql` | 8 | integral |
| `tests/sql/whatsapp-shopping-quota/10-tests.sql` | 86 | integral |
| `tests/whatsapp-audio-duration.test.ts` | 491 | parcial |
| `tests/whatsapp-audio-lote-2026-10-12.test.ts` | 245 | integral |
| `tests/whatsapp-audio.test.ts` | 563 | parcial |
| `tests/whatsapp-boleto-banco-emissor-c10-4.test.ts` | 81 | nao_lido |
| `tests/whatsapp-boleto-c10a-1.test.ts` | 242 | nao_lido |
| `tests/whatsapp-boleto-c10a-1.test.ts.bak.sh` | 0 | nao_lido |
| `tests/whatsapp-boleto-c10a.test.ts` | 350 | parcial |
| `tests/whatsapp-boleto-c10b-hardening.test.ts` | 197 | nao_lido |
| `tests/whatsapp-boleto-c10b-integration.test.ts` | 180 | parcial |
| `tests/whatsapp-boleto-c10b.test.ts` | 233 | parcial |
| `tests/whatsapp-boleto-c10b2.test.ts` | 276 | nao_lido |
| `tests/whatsapp-boleto-rate-limit-3-36.test.ts` | 295 | nao_lido |
| `tests/whatsapp-boleto-wa-c10-3.test.ts` | 188 | nao_lido |
| `tests/whatsapp-c11-f3b2d-boleto-mutex.test.ts` | 129 | parcial |
| `tests/whatsapp-comprovante-categoria-manual.test.ts` | 261 | nao_lido |
| `tests/whatsapp-comprovante-data-2026-10-12.test.ts` | 273 | integral |
| `tests/whatsapp-comprovantes.test.ts` | 1776 | nao_lido |
| `tests/whatsapp-shopping-botoes.test.ts` | 46 | integral |
| `tests/whatsapp-shopping-finance-safety.test.ts` | 180 | integral |
| `tests/whatsapp-shopping-followup-dedupe.test.ts` | 67 | integral |
| `tests/whatsapp-shopping-followup.test.ts` | 201 | integral |
| `tests/whatsapp-shopping-integration.test.ts` | 142 | integral |
| `tests/whatsapp-shopping-mobile-ux.test.ts` | 97 | integral |
| `tests/whatsapp-shopping-mvp.test.ts` | 200 | integral |
| `tests/whatsapp-shopping-pilot.test.ts` | 74 | integral |
| `tests/whatsapp-shopping-real-fixes.test.ts` | 94 | integral |
