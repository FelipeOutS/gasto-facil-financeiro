# AUDITORIA GERAL GASTO INTELIGENTE — 2026-08-04

## 1. Resumo Executivo
- **Percentual Site Web Comercial**: 95% [INFERÊNCIA]
- **Percentual Ecossistema Principal**: 85% [INFERÊNCIA]
- **Percentual Ecossistema Completo**: 70% [INFERÊNCIA]
- **Classificação**: `QUASE PRONTO — BLOQUEADORES PONTUAIS`
- **Bloqueadores Reais**: Configuração final de templates Meta (WhatsApp) e Credenciais de Produção (Mercado Pago).
- **Próxima Ação Recomendada**: Rollout controlado do WhatsApp para usuários da Allowlist.

## 2. Arquitetura
- **Stack**: TanStack Start v1 (React 19, Vite 7) [CÓDIGO]
- **Frontend**: Tailwind CSS v4, Lucide, Framer Motion [CÓDIGO]
- **Backend**: TanStack Server Functions + Lovable Cloud (Supabase) [CÓDIGO]
- **Banco**: PostgreSQL (Supabase) [BANCO]
- **Auth**: Supabase Auth [CÓDIGO]
- **Hosting**: Lovable Cloud (Edge Workers) [DOCUMENTAÇÃO]
- **Tabelas**: ~74 tabelas mapeadas [BANCO]
- **Funções SQL**: ~73 funções identificadas [BANCO]
- **Rotas**: ~102 rotas (.tsx) [CÓDIGO]
- **Testes**: ~2316 aprovados em suíte histórica [DOCUMENTAÇÃO]

## 3. Autenticação, Roles e Planos
- **Owner**: Role master com acesso total (ex: `isAdminMasterUser`) [CÓDIGO]
- **Admin**: Role para moderadores [CÓDIGO]
- **Planos**: `free_ads`, `pessoal_manual`, `pessoal_premium`, `mei_essencial`, `mei_inteligente`, `empresa` [CÓDIGO]
- **Segurança**: RLS habilitado em 100% das tabelas críticas [BANCO]
- **Fonte de Verdade**: Tabela `user_roles` com `SECURITY DEFINER` functions [BANCO]

## 4. Site Público e Autenticação
- **Landing Page**: Restaurada e funcional em `/` [CÓDIGO]
- **SEO/Analytics**: Configurado (Meta tags, GTM, Search Console) [CÓDIGO]
- **Login/Cadastro**: Fluxo completo com redirecionamento pós-auth [CÓDIGO]

## 5. Módulos Financeiros
| Módulo | Estado | Publicado | Testado | Pendência |
|---|---|---|---|---|
| Dashboard | Funcional | Sim | Sim | - |
| Gastos | Funcional | Sim | Sim | - |
| Receitas | Funcional | Sim | Sim | Limite de valor em produção |
| Cartões | Funcional | Sim | Sim | - |
| Faturas | Funcional | Sim | Sim | - |

## 7. WhatsApp
- **Número**: Validado e em uso [DOCUMENTAÇÃO]
- **Status**: Infraestrutura ativa, Dispatcher desligado [CÓDIGO]
- **Templates**:
  - `gi_conta_vencendo_hoje_v1`: `PENDING` (Submetido em 2026-08-04) [BANCO/META]
  - `gi_conta_vencendo_amanha_v1`: `PENDING` (Submetido em 2026-08-04) [BANCO/META]
  - `gi_conta_atrasada_v1`: `PENDING` (Submetido em 2026-08-04) [BANCO/META]

- **Sync**: `whatsappAdminSyncTemplates` implementado (apenas diff/patch local) [CÓDIGO]

## 13. Segurança
- **RLS**: Políticas `has_role(auth.uid(), 'owner')` em tabelas administrativas [BANCO]
- **Seroval**: Protegido contra CVE-2026-59940 (v1.5.6) [CÓDIGO]

## 17. Joanin e Carrefour
- **Estado**: `ADIADO ATÉ A CONCLUSÃO DE TODO O RESTANTE DO PROJETO`
- **Isolamento**: 
  - Joanin: APIs protegidas por role `owner` [CÓDIGO]
  - Carrefour: Apenas referências nominais, sem integração ativa [CÓDIGO]

## 20. Roadmap
1. WhatsApp (Rollout Beta)
2. Mercado Pago (Modo Produção)
3. PWA (Refinamento)
4. Biometria/Passkeys
5. Segurança e LGPD
6. Lançamento Web
7. Android
8. iOS
9. Joanin
10. Carrefour

## 22. Estimativas
- **Liberação Comercial Web**: 2-4 prompts
- **Ecossistema Principal**: 5-8 prompts
- **Android/iOS**: 10-15 prompts
- **Joanin/Carrefour**: Futuro (não estimado)
