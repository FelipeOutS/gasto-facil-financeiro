---
Resumo: Auditoria completa e preparação da infraestrutura de quotas para o beta oficial.
Estado Inicial: WhatsApp Global=OFF, Rollout=0%, 0 usuários beta, 294 logs processados.
Arquitetura: Webhook -> Authz -> Production Gate (Quota Atomic) -> Pipeline -> Messages.
Logs: 931 totais (294 proc, 596 ign, 46 falha). Status: processed, ignored, failed.
Feature Flags: off, shadow, beta, on. Atual: OFF (global_enabled=f).
Allowlist: whatsapp_beta_access (0 usuários ativos).
Entitlements: Paid Plans only + Beta Access + Admin Master bypass.
Planos: Matrix confirmada (Premium, MEI, Empresa). Free/Manual = Quota 0.
Quotas: Inbound (atomic), Outbound (reserve/commit/release), Financial (dedupe).
Reservas: Implementadas via RPCs atômicas com idempotency_key.
Idempotência: Baseada no external_id da Meta.
Telefones: Normalização E.164 + vínculo ativo + opt-in.
Consentimento: whatsapp_links.opt_in_em (LGPD).
Parser: Reutiliza o parser do site com confirmação obrigatória.
Pendências: whatsapp_messages.status (pendente, salva, cancelada, expirada).
Rate Limit: Por IP/Rota e por usuário (24h para bloqueio).
Fila: whatsapp_notifications + dispatcher (status: processing=1).
Dispatcher: WHATSAPP_DISPATCH_ENABLED=false (OFF).
Templates: whatsapp_meta_templates (DRAFT, APPROVED).
Webhook: HMAC SHA-256 + Meta Signature Verify + Zod.
RLS: 100% ativo em todas as 74 tabelas.
Migrations: Estrutura atual suporta o beta sem novas alterações imediatas.
Diagnóstico: /admin_/whatsapp-runtime pronto para Admin Master.
Testes: 2316 testes aprovados (baseline).
Rollback: Feature flag global_enabled=false.
Bloqueadores: Cadastro de secrets de produção do Mercado Pago (pendente).
Próxima Etapa: Submissão de templates oficiais à Meta (Prompt 7).
---
