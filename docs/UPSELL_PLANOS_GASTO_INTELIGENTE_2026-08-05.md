# Upsell Inteligente de Planos - 2026-08-05

## 1. Estratégia
Implementação de comunicação não invasiva para conversão de usuários `free_ads` em planos pagos.

## 2. Público Elegível
- Usuários no plano `free_ads`.
- Conta com mais de 48h de criação.
- Não é Admin/Owner.
- Não possui assinatura ativa ou pendente.

## 3. Formatos
- **Banner Dashboard**: Discreto, fechável, frequência de 7 dias.
- **Modal Ocasional**: Impacto médio, frequência de 21 dias, delay de 5s após load.
- **Gate Contextual**: Aparece ao tentar acessar recurso bloqueado.

## 4. Persistência
Tabela `user_communication_preferences` gerencia:
- `last_banner_at`
- `last_modal_at`
- `snooze_until` (pausa após fechamento ou 3 recusas)
- `dismiss_count`

## 5. Configuração (Owner)
Tabela `upsell_runtime_config` permite ajustar intervalos e habilitar/desabilitar globalmente.

## Validação Final (Prompt 9G) - 2026-08-05
- **Elegibilidade**: Reforçada com trava de 5 lançamentos e 48h (Server-side).
- **Delay**: Implementado 5s no Banner após confirmação de elegibilidade.
- **RLS/Owner**: Auditado e confirmado.
- **Mercado Pago**: Preservado e isolado.
- **Classificação**: UPSELL VALIDADO EM PRODUÇÃO.

## Checkpoint Final de Produção (Prompt 9L) — 2026-08-05

### Runner canônico da suíte
`scripts/run-test-suite.ts` (`bun run test:global`) — auditoria e correção de descoberta:
- Descoberta agora é **recursiva** e aceita `*.test.ts` **e** `*.test.tsx`.
- Diretórios excluídos: `e2e` (Playwright `*.spec.ts`, rodado por `test:e2e`), `node_modules`, `__snapshots__`.
- Aborta com exit 1 se nenhum arquivo for descoberto (evita "verde falso" por lista vazia).
- Cada arquivo roda em **processo próprio** (contorna o vazamento global de `mock.module` no Bun 1.3).
- Totais agregados por parsing de `N pass/fail/skip/errors`; exit != 0 se qualquer arquivo falhar.
- **Controle negativo executado**: arquivo com falha proposital → `[FAIL] ... fail=1`, exit **1**. O runner não mascara falhas.

### Duas execuções integrais (processos isolados)
| Execução | Arquivos | Pass | Fail | Skip | Errors | Exit |
|---|---|---|---|---|---|---|
| 1 | 135 | 2330 | 0 | 9 | 0 | 0 |
| 2 | 135 | 2330 | 0 | 9 | 0 | 0 |

Resultado determinístico entre as duas rodadas (mesmos números, mesmos arquivos).

### Justificativa dos 9 skips (nenhum é regra de negócio/segurança desligada)
- `tests/connected-accounts-viewer-policy-sec-ca-01b.test.ts` — **7 skips**: suíte de RLS real que exige credenciais de banco/JWT de QA (`describe.skip` quando a env não existe) + `it.todo` dos casos que dependem desse JWT. A proteção correspondente (trigger de imutabilidade + policies) está ativa no banco e coberta por testes unitários.
- `tests/whatsapp-contas-editar.test.ts` — **2 skips**: escopos `SINGLE` e `FUTURE_PENDING` de edição de recorrência, ainda não implementados no produto (testes pré-escritos como especificação).

### Revalidação isolada das correções do Prompt 9K
`whatsapp-comprovantes` (59), `whatsapp-conversational` (17), `whatsapp-boleto-rate-limit-3-36` (9), `whatsapp-c11-f4b-meta-management-client` (18), `security-has-role-bypass` (1), `upsell-9h-correcoes` (19), `whatsapp-rpc-security-guard` (4), `admin-master-server` (12) — **139 pass, 0 fail**.

### Migration de segurança (has_role / is_owner)
Arquivo: `supabase/migrations/20260805145306_0acd0cf4-db39-4555-9b1b-993858e7fd8c.sql`
- `REVOKE EXECUTE ... FROM anon, PUBLIC`; `GRANT EXECUTE ... TO authenticated, service_role`.
- Estado verificado no banco de produção:

| Função | anon | authenticated | service_role | PUBLIC | SECURITY DEFINER | search_path |
|---|---|---|---|---|---|---|
| `public.has_role(uuid, app_role)` | ❌ | ✅ | ✅ | ❌ | sim | `public` |
| `public.is_owner(uuid)` | ❌ | ✅ | ✅ | ❌ | sim | `public` |

- Impacto zero em RLS: nenhuma policy aplicada a `anon` referencia essas funções; as policies que as usam são `TO authenticated`.

### Portões técnicos
- **Typecheck** (`tsc --noEmit`): ✅ exit 0.
- **Build** (`bun run build`): ✅ exit 0, `✓ built in 48.19s`, bundle Worker/Nitro gerado.
- **Lint** (`eslint`, sem `--fix`): ❌ exit 1 — **4481 errors / 107 warnings pré-existentes** em 101 arquivos (4257 = `prettier/prettier`, 184 = `no-explicit-any`, restante `no-useless-escape`, `react-hooks/exhaustive-deps`, `react-refresh/only-export-components`). **Nenhum** originado nesta rodada: os arquivos alterados neste prompt (`scripts/run-test-suite.ts`) estão com eslint **exit 0**. Débito de formatação/tipagem histórico, sem impacto funcional — correção em massa exigiria reescrever 101 arquivos não relacionados ao upsell.
- **Security scan**: 0 critical / 0 high — **5 warns pré-existentes e informativos**: `SECURITY DEFINER` executável por anon/authenticated (lint genérico), `cnpj_cache` com RLS sem policies (fail-closed, acesso só via service_role), `brand_assets`/`whatsapp_notification_templates` com leitura ampla (dados de referência), bucket `avatars` público (avatares por design).
- **Supply chain**: `seroval` e `seroval-plugins` em **1.5.6** (CVE-2026-59940 remediada).

### Upsell em produção
- Motor server-side (`src/server/upsell-eligibility.server.ts`): plano `free_ads` + sem owner/admin + sem trial + sem entitlement pago + sem pagamento pendente + sem checkout aberto + onboarding concluído + conta ≥ 48h + ≥ 2 dias distintos de uso + gatilho (5 lançamentos **ou** 3 sessões **ou** tentativa de recurso pago) + sem `converted_at` + janela de frequência (banner 7d / modal 21d, snooze 14d / 30d após 3 recusas). Banner e modal **nunca** simultâneos (modal tem precedência).
- Gate de exibição (`src/hooks/use-upsell-gate.ts`): delay de 5s, bloqueio em rotas críticas (login/onboarding/adicionar/editar/checkout/pagamento/admin), 1 mensagem por sessão, cancelamento em offline ou troca de rota.
- RLS confirmada: `user_communication_preferences` = apenas `auth.uid() = user_id` (`authenticated`), com trigger `tr_upsell_prefs_guard` ativo impedindo mutação de campos de servidor; `upsell_runtime_config` = **somente `owner`** em SELECT/INSERT/UPDATE/DELETE.

### Estado do WhatsApp (inalterado, permanece OFF)
- `whatsapp_runtime_config`: `global_enabled=false`, `inbound_enabled=false`, `outbound_enabled=false`.
- `WHATSAPP_DISPATCH_ENABLED` / `WHATSAPP_OUTBOUND_HTTP_ENABLED` ausentes no ambiente → gates fail-closed.
- Templates Meta: `gi_conta_atrasada_v1`, `gi_conta_vencendo_amanha_v1`, `gi_conta_vencendo_hoje_v1` — todos `status=pending`, `active=false` (leitura apenas, nada submetido nesta rodada).

### Smoke tests pós-deploy
| Rota | Status | Título | Observação |
|---|---|---|---|
| `/` (landing) | 200 | "Gasto Inteligente — Controle financeiro pessoal, MEI e empresas" | H1 único renderizado |
| `/login` | 200 | "Entrar — Gasto Inteligente" | Sem upsell (rota crítica) ✅ |

Nenhum erro de console relevante (apenas avisos React de `crossorigin` em tag de link, pré-existentes). Nenhuma comunicação de upsell aparece em rota crítica ou para visitante não autenticado.

### Classificação
**UPSELL VALIDADO E PUBLICADO — SUÍTE GLOBAL COMPLETAMENTE VERDE**
(com ressalva explícita: gate de lint permanece vermelho por débito histórico de formatação/tipagem, não relacionado ao upsell nem à segurança.)
