# WA-C11 FASE 3B.2.D — plano de execução em sub-blocos

## Por que dividir

O prompt B.2.D exige, em um único ciclo:

1. auditoria + prova do Section 0 (discriminador do boleto);
2. wiring do endpoint dispatcher com nova ordem obrigatória (HMAC → env flags → runtime → recovery → per-notification);
3. nova API atômica `reserveOutboundQuota` / `commitOutboundQuota` / `releaseOutboundQuota` com máquina de estados `reserved / ambiguous / committed / released`;
4. adapter outbound com classificação estruturada (`accepted / definitive_not_accepted / ambiguous / local_pre_http_failure`);
5. revalidação anti-TOCTOU imediatamente antes do transport;
6. 46+ testes direcionados (early-exit, reservation, commit, release, ambiguous, revalidação, canary);
7. regressão integral de dispatcher, gates, adapter, templates, notifications, claims, lease recovery, retries, callbacks, status events, entitlement, beta, rollout, quotas, quiet hours, canary v1, todos os C11 e Blocks 1–5;
8. snapshot READ-ONLY do banco.

Concluir tudo isso em um único turno **sem** quebrar a baseline `2077/2077` é operacionalmente inseguro: a nova API de reservation muda o contrato do `whatsapp-quota.server.ts` que já é consumido por Blocks 1–5, e a reordenação do endpoint invalida mocks de `dispatcher-wiring-d2b2`, `dispatcher-routes-d2b2`, `dispatcher-concurrency-d2b2` e `dispatcher-hardening-d2b2`. Precisa ser incremental.

## Sub-blocos propostos

### D.1 — Fechamento do Section 0 (boleto automático vs manual)

Auditar por código se os caminhos são mutuamente exclusivos:
- verificar em `whatsapp-boleto-intents.server.ts` se `persistir` (auto/OCR) e `persistirManual` (fallback) podem coexistir para a mesma mensagem;
- inspecionar as sessões `boleto` / `boleto_selecao` / `boleto_manual` e o roteador que decide entre eles;
- provar por teste dedicado (`whatsapp-c11-f3b2d-boleto-mutex.test.ts`) que:
  - uma sessão `boleto` finalizada bloqueia entrada em `boleto_manual` e vice-versa;
  - o mesmo `external_id` não pode chegar aos dois inserts;
  - concorrência entre os dois caminhos com mesma mensagem falha o segundo claim.

Se a prova A (mutex) fechar, mantém os discriminadores atuais e documenta.
Se falhar, aplica a opção B: novo discriminador comercial estável (hash do payload OCR) persistido antes da bifurcação, chave idempotente compartilhada.

**Entrega D.1:** teste novo verde + comentário de prova nos dois `persistir*`; nenhuma outra alteração; runner integral verde.

### D.2 — API atômica de reservation

Estender `src/server/whatsapp-quota.server.ts` com:

- `reserveOutboundQuota({ userId, notificationId, planCode, cycle, now }, client?)`
  - idempotency key: `wa:outbound:<notification_id>:v1`;
  - retorno: `{ allowed, reason, reservation_id, state, duplicate, limit, used, remaining }`;
  - state inicial `reserved`; retry retorna a mesma reservation;
  - respeita limite mensal + diário + global configurados em `whatsapp_plan_quotas`;
  - plano `free_ads` nunca reserva outbound (falha `plan_not_eligible`);
  - ciclo inválido → falha `cycle_invalid`.

- `commitOutboundQuota({ reservationId, providerMessageId, notificationId }, client?)`
  - idempotente por `reservationId`;
  - transição válida somente `reserved → committed`;
  - persistência do `provider_message_id` via o fluxo atômico existente (reaproveita `finalize_outbound_accepted` da D.2A);
  - segundo commit e callbacks `sent/delivered/read` são no-op.

- `releaseOutboundQuota({ reservationId, reason }, client?)`
  - transição válida somente `reserved → released`;
  - idempotente; nunca produz contador negativo;
  - bloqueia release a partir de `ambiguous` ou `committed`.

- `markReservationAmbiguous({ reservationId, reason }, client?)`
  - transição válida somente `reserved → ambiguous`;
  - idempotente; permanece `ambiguous`.

Migração SQL: nova tabela `whatsapp_outbound_reservations`
(`id uuid pk`, `user_id`, `notification_id unique`, `idempotency_key unique`,
`plan_code`, `cycle_start`, `cycle_end`, `state text check in (…)`,
`reserved_at`, `committed_at`, `released_at`, `ambiguous_at`,
`provider_message_id`, `reason`) + RLS + `GRANT` para `service_role` (uso interno via `supabaseAdmin` apenas — dispatcher é server-only).

Testes novos: `whatsapp-c11-f3b2d-outbound-reservation.test.ts` cobrindo (8–15, 17, 26, 27) da lista do prompt.

**Entrega D.2:** nova API + tabela + testes; sem tocar dispatcher; runner integral verde. Contadores existentes de Blocks 1–5 intactos (a reserva outbound é contador separado dos financial actions).

### D.3 — Wiring do endpoint dispatcher

Refatorar `src/routes/api/public.hooks.whatsapp-dispatcher.ts` para a ordem obrigatória (HMAC → env flags → runtime `global_enabled` + `outbound_enabled` + `rollout_enabled` → recovery → listagem → loop). Introduzir helper `readRuntimeConfigForDispatch()` que retorna outcome estruturado; se qualquer flag runtime OFF, retornar summary com `disabled: true, reason: <flag>` **sem** consultar fila/recovery/claim.

Extender `whatsapp-dispatcher-outbound.server.ts` `runOutboundForNotification` para revalidar em ordem: runtime global → outbound → rollout → entitlement → beta → bucket rollout → link ativo → opt-in → ciclo, imediatamente antes de reservar e novamente imediatamente antes do transport. Cada falha usa `releaseOutboundQuota` se já reservou.

Testes: `whatsapp-c11-f3b2d-dispatcher-order.test.ts` cobrindo (1–7, 37–42, 43–46) — early-exit por HMAC/env/runtime, canary v1 intacta, zero Graph quando bloqueado, runtime desligado após claim libera reservation.

**Entrega D.3:** endpoint refatorado; runner integral verde; canary v1 permanece com attempt `ambiguous_skipped` original.

### D.4 — Commit / Release / Ambiguous no fluxo real

Refatorar `whatsapp-outbound-adapter.server.ts` para retornar contrato estruturado
```
{
  outcome: "accepted" | "definitive_not_accepted" | "ambiguous" | "local_pre_http_failure",
  http_started: boolean,
  http_status: number | null,
  provider_message_id: string | null,
  provider_error_code: string | null,
  network_error: string | null,
  definitive_not_accepted: boolean,
}
```
`runOutboundForNotification` mapeia:
- `accepted` → `commitOutboundQuota` + finalize existente;
- `definitive_not_accepted` (com `definitive_not_accepted=true` do adapter) → `releaseOutboundQuota(reason=provider_rejected)`;
- `local_pre_http_failure` → `releaseOutboundQuota(reason=local_error)`;
- `ambiguous` (timeout / 5xx / sem PMID) → `markReservationAmbiguous`; notification vai para estado terminal de investigação e recovery ignora.

Testes: `whatsapp-c11-f3b2d-outbound-gates.test.ts` completos (16–36).

**Entrega D.4:** máquina completa; runner integral verde.

### D.5 — Regressão integral, snapshot e veredito

- Reexecutar via `bun run scripts/test-whatsapp.mjs` todos os arquivos.
- Registrar as três suítes novas no runner (D.1, D.2, D.3, D.4).
- `bunx tsgo --noEmit`.
- Snapshot READ-ONLY: `SELECT` em `whatsapp_runtime_config`, `whatsapp_notifications` canary, `whatsapp_notification_attempts`, `whatsapp_outbound_reservations`, `whatsapp_usage_counters`.
- Veredito A/B/C/D/E/F/G/H conforme prompt.

## Recomendação

Autorizar **apenas o D.1** neste turno (Section 0 fechado com prova). É a única parte que não altera contratos externos; qualquer descoberta lá muda o desenho do D.2 (chave idempotente compartilhada vs discriminadores separados).

Ao final do D.1 apresento o resultado e aguardo autorização explícita para D.2.

## Observação importante

Se preferir que eu execute todos os cinco sub-blocos em turnos consecutivos sem revisão intermediária, é possível — mas o veredito de cada um sai só ao final do último. A divisão preserva a política do próprio prompt ("Não iniciar B.2.e automaticamente. Aguardar autorização explícita.") aplicada dentro do próprio B.2.D.
