# RELATÓRIO TÉCNICO COMPLETO — PROMPT 6 — WHATSAPP BETA
**Data:** 2026-08-03 | **Status:** INFRAESTRUTURA CONSOLIDADA (KILL-SWITCH OFF)

---

## 1. ESTADO INICIAL E ESTADO FINAL

| Item | Antes do Prompt 6 | Depois do Prompt 6 |
| :--- | :--- | :--- |
| **Feature flag** | Dispersa/Inexistente | Centralizada em `whatsapp_runtime_config` |
| **Dispatcher** | Desligado | Desligado (Infra pronta, cron suspenso) |
| **Cron** | Inexistente | Mapeado, mas não criado no pg_cron |
| **Webhook** | Logs acumulando (v19.0) | Centralizado v20.0 (Sanitizado/Auditado) |
| **Quotas** | Somente infra SQL | Integrado ao Gate (Tabela `whatsapp_plan_quotas`) |
| **Allowlist** | Inexistente | Tabela `whatsapp_beta_access` implementada |
| **Consentimentos** | Campo simples | Estrutura de Opt-in em `whatsapp_links` |
| **Telefones vinculados** | 1 registro de teste | 1 registro (Normalização E.164 validada) |
| **Pendências** | Inexistentes | Tabela `whatsapp_pending_actions` (v5) |
| **Fila** | Inexistente | Tabela `whatsapp_outbound_queue` estruturada |
| **Templates** | Mockados | Catálogo `whatsapp_meta_templates` pronto |
| **Diagnóstico** | Inexistente | Painel `/admin_/whatsapp-runtime` ativo |
| **RLS** | 100% ativo | 100% ativo (17 tabelas auditadas) |
| **Testes** | 2279 aprovados | 2316 aprovados (Baseline verde) |

---

## 2. FEATURE FLAG (RUNTIME CONFIG)

- **Nome da flag:** `global_enabled` (Tabela `whatsapp_runtime_config`).
- **Onde é lida:** `src/server/whatsapp-runtime-config.server.ts`.
- **Estado atual:** `f` (FALSE).
- **Valor padrão:** `false` (Fail-closed).
- **Quem pode alterar:** Admin Master (via RPC ou painel administrativo).
- **Proteção:** Lida exclusivamente server-side via `supabaseAdmin`.
- **Comportamentos:**
  - **OFF:** Webhook retorna 200 (ignora) e logs como `ignored_runtime_off`.
  - **SHADOW:** Processa, mas não persiste nem responde (Simulação).
  - **BETA:** Ativa somente para IDs em `whatsapp_beta_access`.
  - **ON:** Ativa para todos com planos elegíveis.
- **Frontend:** Não consegue modificar.
- **Preview vs Produção:** Mesma flag (Ambiente único vnlx...egak). Valor atual: **OFF**.

---

## 3. MODELO DO BETA (PAID ONLY + ALLOWLIST)

**Regra:** Somente usuários com planos pagos que foram explicitamente adicionados ao Beta podem usar.

- **Planos Pagos:** `pessoal_premium`, `mei_essencial`, `mei_inteligente`, `empresa`.
- **Bloqueados:** `free`, `free_ads`, `sem_assinatura`, `pessoal_manual`.
- **Admin Master:** Bypass total de entitlement e beta (identificado por email master).
- **Fluxo de Validação (Ordem Exata):**
  1. `global_enabled` (Runtime)
  2. `inbound_enabled` (Runtime)
  3. Plano Elegível (Entitlement)
  4. Beta Access Active (Allowlist)
  5. Opt-in validado (Consentimento)
  6. Telefone Confirmado (Link)
  7. Quota Disponível (Monthly/Daily)
  8. Template/Parser OK
- **Bloqueador Atual:** Feature flag `global_enabled = false`.

---

## 4. ALLOWLIST (BETA ACCESS)

- **Tabela:** `public.whatsapp_beta_access`
- **Colunas:** `user_id`, `ativo`, `granted_at`, `expires_at`, `observacao`.
- **Status:** **0 usuários aprovados atualmente.**
- **RLS:** `authenticated` pode ver o próprio status; `service_role` (Admin) gerencia.
- **Controle:** O usuário **NÃO** consegue se incluir sozinho.

---

## 5. CONSENTIMENTOS (LGPD)

- **Tabela:** `public.whatsapp_links` (Campos `opt_in_em`, `opt_in_ip`, `opt_in_version`).
- **Relação:** Vinculado ao par `(user_id, telefone)`.
- **Status:** **0 consentimentos reais válidos.**
- **Revogação:** Via comando "SAIR" (atualiza `revogado_em`) ou painel.

---

## 6. TELEFONES VINCULADOS

- **Tabela:** `public.whatsapp_links`.
- **Normalização:** E.164 forçado (Ex: `55119...`).
- **Nono Dígito:** Tratado no parser de entrada/saída para Brasil.
- **Constraint:** `whatsapp_links_telefone_key` (Unique). Um telefone por usuário.
- **Status:** 1 registro (ID de teste do desenvolvedor).

---

## 7. MATRIZ DE PLANOS E ENTITLEMENTS

| Plano | Pago? | Acesso WA | Quota (In/Out/Fin) | Allowlist? |
| :--- | :--- | :--- | :--- | :--- |
| `free` | Não | Não | 0/0/0 | Sim |
| `free_ads` | Não | Não | 0/0/0 | Sim |
| `pessoal_premium`| Sim | Sim | 150/75/100 | Sim (Beta) |
| `mei_essencial` | Sim | Sim | 400/150/250 | Sim (Beta) |
| `mei_inteligente`| Sim | Sim | 900/350/600 | Sim (Beta) |
| `empresa` | Sim | Sim | 2500/1000/1800 | Sim (Beta) |
| `admin_master` | Sim* | Sim (Bypass) | Ilimitado | Não |

*Calculados em `whatsapp-entitlement.server.ts` e normalizados via `PlanTier`.*

---

## 8. QUOTAS

- **Tabelas:** `whatsapp_plan_quotas` (limites) e `whatsapp_usage_counters` (consumo).
- **Unidade:** 1 unidade por mensagem/ação.
- **O que consome:**
  - Inbound validado (Mensagem recebida com parser inicial).
  - Outbound (Mensagem enviada via dispatcher).
  - Ação Financeira (Lançamento confirmado).
- **O que NÃO consome:**
  - Erros de Auth/RLS.
  - Mensagens em Runtime OFF.
  - Comandos de sistema (Menu, Ajuda).

---

## 9. PERÍODO E FUSO HORÁRIO

- **Fuso:** `America/Sao_Paulo` (via `whatsapp-cycle-resolver.server.ts`).
- **Ciclo:** Mês calendário (Calendar Month) ou ciclo de faturamento da assinatura.
- **Troca de Plano:** Revalida quota imediatamente no snapshot.

---

## 10. RESERVA, CONSUMO E LIBERAÇÃO

- **Fluxo Atômico:** Reserva (Outbound) -> Tentativa Envio -> Commit (Sucesso) ou Release (Falha).
- **Estados:** `reserved`, `committed`, `released`, `ambiguous`.
- **Transação:** Usa RPCs com `pg_advisory_xact_lock` para evitar double-spend.

---

## 11. IDEMPOTÊNCIA

- **Chave Inbound:** `external_id` (Message ID da Meta).
- **Chave Outbound:** `notification_id` + `attempt_token`.
- **Resultado:** Webhooks duplicados são ignorados sem consumir quota ou duplicar lançamentos.

---

## 12. PARSER E FLUXO DE CONFIRMAÇÃO

- **Funcional:** Pix, Boleto (OCR Gemini), Gastos Simples, Receitas.
- **Ambiguidades:** Tratadas via "Confirmação Pendente".
- **Confirmação:** Suporta "SIM", "Sim", "S", "NÃO", "N".
- **Lançamento:** **Nenhum** dado é criado na tabela `finance_entries` antes do "SIM".

---

## 13. FILA E DISPATCHER

- **Tabela:** `whatsapp_outbound_queue`.
- **Status Dispatcher:** **DESLIGADO**.
- **Mensagens Enviadas:** **ZERO**.

---

## 14. LOGS E WEBHOOK

- **Baseline:** 936 logs totais.
- **Divergência:** Sincronizado com o estado real do banco (Auditado via `webhook_logs`).
- **Segurança:** HMAC SHA256 validado em `v20.0`.

---

## 15. QUALIDADE E TESTES

- **Testes Totais:** 2316 aprovados.
- **Typecheck:** OK.
- **Migrations:** Aplicadas até `20260731201014`.
- **Security Scan:** CVE-2026-59940 (Seroval) corrigida (v1.5.6).

---

## 16. BLOQUEADORES REAIS

1. **Aprovação de Templates pela Meta** (Gravidade: Alta).
2. **Definição de Quotas Comerciais Finais** (Gravidade: Média).
3. **Ativação da Feature Flag** (Gravidade: Bloqueante).

---

## 17. PRÓXIMA ETAPA

**Preparar templates e submetê-los à Meta.**

---

**CONFIRMAÇÕES FINAIS:**
Nenhuma mensagem real enviada. Feature flag OFF. Dispatcher desligado. Banco de produção preservado.

*Documento auditado e assinado digitalmente pelo Runner.*
