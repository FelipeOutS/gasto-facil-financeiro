# RELATÓRIO TÉCNICO — GASTO INTELIGENTE P6 (REORGANIZAÇÃO DE PRIORIDADES)
Data: 2026-08-04
Versão: 4.0 — ESCOPO MISTURADO (CORREÇÃO E ISOLAMENTO)

## 1. STATUS GERAL DO CUTOVER
- **Joanin / Carrefour**: ISOLADOS (Acesso restrito a `owner`).
- **WhatsApp**: INFRAESTRUTURA PUBLICADA (Templates em `draft`, Dispatcher desligado).
- **Mercado Pago**: MODO PRODUÇÃO ATIVO (Aguardando secrets oficiais).

## 2. AUDITORIA DE ISOLAMENTO (WA-SEC-JOANIN-01)
Implementada proteção multinível para descontinuar o caminho crítico de integração de mercados:
- **API**: `src/routes/api/mercado-joanin-import.ts` e `src/routes/api/mercado-flyer-ocr.ts` agora exigem `isAdminMasterUser(user)` no server-side.
- **UI**: Botões de importação em `src/routes/mercado_.preco-comunitario.tsx` desabilitados funcionalmente para não-owners, com feedback de manutenção.
- **RLS**: Aplicado bloqueio em `whatsapp_meta_templates` e `whatsapp_runtime_config` para garantir que apenas Admin Master gerencie a infraestrutura.

## 3. STATUS DOS TEMPLATES WHATSAPP (PROMPT 7)
- **Status Local**: 3 templates registrados no banco como `draft`.
- **Sincronização**: Infraestrutura `whatsappAdminSyncTemplates` preparada para Diff/Patch, mas NÃO submetida à Meta.
- **Veredito**: Mantido em `draft` até nova ordem.

---
**JOANIN E CARREFOUR NÃO BLOQUEIAM MAIS O LANÇAMENTO DO GASTO INTELIGENTE**
