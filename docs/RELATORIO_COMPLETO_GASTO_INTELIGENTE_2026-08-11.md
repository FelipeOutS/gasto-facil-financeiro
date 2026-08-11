# Relatório Completo — Gasto Inteligente

**Data:** 11/08/2026 · **Versão do app:** 2.6.0
**Domínios:** gastointeligente.com.br (HTTP 200), www.gastointeligente.com.br, gasto-facil-financeiro.lovable.app

---

## 1. Panorama executivo

O Gasto Inteligente é hoje uma plataforma financeira completa (pessoal + MEI/empresa) em produção, com PWA publicada, base de dados endurecida por RLS, telemetria de estabilidade ativa e uma suíte automatizada de 2.381 testes 100% aprovada.

| Indicador | Valor atual |
|---|---|
| Rotas da aplicação | 117 arquivos de rota |
| Componentes React | ~90 componentes raiz + 20 pastas de domínio |
| Módulos de servidor (`src/server`) | 98 |
| Linhas de código (src) | ~198.000 em 601 arquivos |
| Testes automatizados | 141 arquivos · 2.381 PASS / 0 FAIL / 9 skip |
| Linhas de teste | ~43.000 |
| Migrações de banco | 164 |
| Tabelas públicas | 79 (79 com RLS ativo) |
| Políticas RLS | 321 |
| Usuários cadastrados | 37 |
| Achados de segurança (scanners) | 0 Critical / 0 High / 0 abertos |

**Veredito:** produto tecnicamente pronto para operação comercial. Os únicos bloqueios reais são **externos**: credenciais produtivas do Mercado Pago e aprovação dos templates da Meta (WhatsApp).

---

## 2. O que está forte (pontos de força consolidados)

### 2.1 Segurança e isolamento de dados
- **RLS em 100% das tabelas públicas** (79/79) com 321 políticas — nenhuma política permissiva `true` em tabelas de dados de usuário.
- **Isolamento por `user_id`** validado em fluxos críticos (WhatsApp, gastos, contas, cartões, cofre pessoal).
- **Funções `SECURITY DEFINER` auditadas**, com restrições de `auth.role()` e validação de `auth.uid()`.
- **Proteção contra escalada de privilégios** em `connected_accounts` (gatilhos de imutabilidade, hardening WA-SEC-CA-01).
- **Papéis em tabela separada** (`user_roles` + `has_role`), sem role no perfil — sem vetor de escalada.
- **Zero segredos no frontend**; `service_role` e senha de banco inacessíveis por design.
- **Headers de segurança reais** injetados no `fetch` do servidor: HSTS com preload, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, CSP em modo *report-only* com `report-uri`.
- **CVE seroval (2026-59940)** corrigida (v1.5.6).
- **Rate limit atômico** via `pg_advisory_xact_lock` e RPCs atômicas (baixa de conta, quotas, parcelamento).

### 2.2 Estabilidade e observabilidade
- **BUILD_ID + recuperação de version skew**: instrumentação no `entry-client` captura falhas de preload/chunk e recupera automaticamente — fim do "Algo deu errado" que exigia Ctrl+Shift+R.
- **Service Worker Network-First** com kill-switch e página offline.
- **Telemetria de carregamento** (`client_load_errors`) e **CSP reports** (`csp_reports`) com RLS fail-closed (só `service_role`), payload limitado (32KB/10KB), Zod e sanitização server-side anti-PII.
- **Resultado real:** **0 erros de carregamento** registrados desde a ativação — indicador direto de que a correção de skew funcionou.
- Endpoints públicos versionados: `/api/public/app-version`, `/client-load-error`, `/csp-report`.

### 2.3 Produto e funcionalidades
- **Financeiro pessoal completo:** gastos, receitas, contas a pagar/receber, cartões e faturas, parcelamentos, orçamento, metas, guardado, investimentos (com importação em lote), calendário financeiro, relatórios.
- **Dashboard redesenhado** (grid 12 colunas, até 1560px) com saúde financeira, diagnóstico mensal, previsão do mês, insights de cartões, alertas e dicas.
- **Empresa/MEI:** consulta e cadastro por CNPJ, fornecedores, clientes, relatórios e pacote para contador.
- **Mercado:** listas, carrinho, cesta, preços históricos e comunitários, calculadoras, importação de cupom, orçamento de mercado.
- **Gasto AI** (assistente financeiro), **Radar Econômico** (câmbio/conversor), **Cofre Pessoal** (senhas), **Contas conectadas** (acesso compartilhado com permissão).
- **Central de Ajustes** completa: conta/perfil, aparência (tema + cor de destaque), preferências financeiras, notificações, privacidade e ajuda (suporte, termos, privacidade) — 8/8 cards validados em produção.
- **i18n PT/EN** com troca de idioma no app e rotas localizadas.
- **PWA** instalável, manifest e offline funcionais em produção.
- **Mobile shell dedicado**: bottom nav, top bar, sheets de ações rápidas e "mais", notificações.

### 2.4 WhatsApp (maior ativo técnico do projeto)
Infraestrutura de ponta a ponta, com ~60 módulos servidores dedicados e a maior parte da suíte de testes:
- Registro de gastos por **texto, áudio (Whisper/Gemini) e imagem/PDF** com OCR de comprovantes e boletos (cache LRU).
- **Parser Pix**, favorecidos, tokens de revelação, transferências.
- Consultas conversacionais: gastos, receitas, faturas, contas, metas, orçamento, recorrências, mês nomeado.
- **Memória de categorias por comerciante** (aprende com o usuário).
- **Notificações** com quiet hours via `pg_cron`, lease/`claim_token`, callbacks da Meta com proteção CAS, opt-out com precedência.
- **Quotas financeiras atômicas**, entitlement por plano, allowlist beta, painel admin de runtime e quotas.
- Graph API unificada em v20.0, sanitizador de erros de transporte com guarda anti-retry.
- Sessão de comprovante durável (`receipt-session-durable-v5`) com readback guard.

### 2.5 Monetização e planos
- Arquitetura de **entitlement multiplataforma** (`src/lib/entitlements.ts`): web, App Store, Google Play, manual, admin, trial → plano efetivo determinístico, com `admin_master` imune a rebaixamento.
- Catálogo de planos: `free_ads`, `pessoal_manual`, `pessoal_premium`, `mei_essencial`, `mei_inteligente`, `empresa`.
- **`free_ads` como padrão** para novos usuários, com limites definidos e anúncios (AdSense + slots próprios) e consentimento de cookies.
- **Motor de upsell** com controle de frequência (`use-upsell-gate`) e modais de bloqueio premium honestos.
- Mercado Pago: checkout, webhooks verificados, reconciliação, resolvedor de cancelamento, diagnósticos — em **fail-closed** até as credenciais produtivas.

### 2.6 LGPD e jurídico
- Termos de Uso, Política de Privacidade, página LGPD e Central de Privacidade publicadas.
- **Exclusão seletiva de dados** e exclusão de conta funcionais (limpeza de Auth + dados vinculados), com matriz de auditoria documentada.
- Banner de consentimento de cookies com registro.
- Mapa de dados e terceiros, plano de resposta a incidentes documentados.

### 2.7 Qualidade e engenharia
- **2.381 testes PASS / 0 FAIL** (suíte global `bun scripts/run-test-suite.ts`), + Playwright E2E.
- Typecheck, build e lint limpos.
- 164 migrações versionadas; nenhuma alteração em schemas gerenciados.
- Documentação técnica extensa em `docs/` (auditorias, incidentes, checklists, matriz de funcionalidades).
- Google Search Console conectado, GTM instalado, `robots.txt` liberado, `sitemap.xml` servindo 200, `llms.txt` publicado.

---

## 3. Histórico do que já foi feito (marcos)

| Fase | Entregas |
|---|---|
| Núcleo financeiro | Gastos, receitas, contas, cartões, faturas, orçamento, metas, investimentos, relatórios |
| WhatsApp WA-G/WA-V/WA-M | Sessão durável de comprovante, isolamento por usuário, áudio + normalização monetária, memória de comerciante |
| WA-C6 a WA-C10 | Faturas, contas a pagar, UX conversacional, Pix, notificações com quiet hours, OCR de boletos, RPC atômica de baixa |
| WA-C9.2 (D/E) | Lease + callbacks Meta, notification attempts, transporte outbound, canary, sanitizador de erros |
| WA-C11 | Entitlement e billing, quotas financeiras em todos os fluxos, dispatcher, opt-out, painel admin, catálogo/sync de templates Meta |
| Segurança | RLS total, hardening `connected_accounts`, RPC guards, rate limit atômico, CVE seroval, headers/CSP report-only |
| Comercial/SEO | Landing em `/`, limpeza de artefatos técnicos, GSC + GTM, sitemap, PWA publicada |
| Estabilidade | BUILD_ID, SW network-first, recuperação de version skew, telemetria de load + CSP |
| UX | Redesign do dashboard, sidebar com scroll persistente, Central de Ajustes e Privacidade |
| Planos | `free_ads` padrão, limites, upsell inteligente, entitlement multiplataforma |

---

## 4. Estado real de tráfego e uso (produção)

| Métrica | Valor |
|---|---|
| Usuários em Auth | 37 |
| Perfis | 37 |
| Planos ativos | 35 `free_ads` ativo · 1 `pessoal_manual` ativo · 1 `pessoal_manual` aguardando pagamento |
| Gastos registrados | 81 |
| Mensagens WhatsApp processadas | 269 |
| Erros de carregamento (telemetria) | 0 |
| CSP reports (7 dias) | 677 (report-only, majoritariamente preview) |

Leitura: base ainda pequena e concentrada no plano gratuito — o gargalo hoje é **aquisição e conversão**, não capacidade técnica.

---

## 5. O que ainda precisa de atenção

### Bloqueadores externos (P1)
1. **Mercado Pago produtivo** — sem `CLIENT_ID`/`SECRET` oficiais, planos pagos permanecem suspensos na UI (fail-closed). É o item nº1 para receita.
2. **Templates WhatsApp na Meta** — em `PENDING`; dispatcher desligado e allowlist vazia até aprovação.

### Técnico (P2)
3. **CSP em enforce** exige ajustes já mapeados: liberar `*.supabase.co` em `connect-src` e `img-src`, decidir entre `'unsafe-eval'` ou refatorar os 4 disparos de `eval` no bundle, e ignorar o ruído de `cdn.gpteng.co` (preview).
4. **3 warnings legados** do linter de banco: `search_path` mutável em `whatsapp_cleanup_csp_reports` e privilégios de execução de funções `SECURITY DEFINER` para anon/auth.
5. **`anonymous_id`** existe no schema mas não é gerado pelo cliente — decidir usar (com minimização) ou remover a coluna.
6. **Android nativo** fora do workspace: PWA cobre o uso, mas publicação na Play Store exige o código nativo.
7. **Revisão jurídica profissional** dos textos legais (controles técnicos prontos, texto ainda não revisado por advogado).

### Comercial (P1)
8. **SEO/conteúdo**: base técnica pronta (GSC, sitemap, GTM), falta produção de conteúdo e páginas de captura para gerar tráfego orgânico.
9. **Conversão free_ads → pago** só será mensurável após o checkout ser reativado.

---

## 6. Recomendação de próximos passos (ordem de impacto)

1. Obter credenciais produtivas do Mercado Pago e reativar o checkout com um pagamento real de validação.
2. Acompanhar aprovação dos templates Meta e ligar o WhatsApp para a allowlist beta.
3. Corrigir a CSP e migrar de *report-only* para *enforce*.
4. Zerar os 3 warnings de banco e decidir o destino do `anonymous_id`.
5. Investir em aquisição: conteúdo SEO, landing pages de campanha e onboarding otimizado.
6. Revisão jurídica dos documentos legais antes de escalar a base.

---

**Classificação final:** *Produto sólido, seguro e estável em produção — pronto para escalar assim que os dois bloqueios externos (pagamento e WhatsApp) forem liberados.*
