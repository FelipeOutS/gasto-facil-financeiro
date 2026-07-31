# RELATÓRIO COMPLETO DE AUDITORIA — GASTO INTELIGENTE
**Data:** 2026-07-31 · **Modo:** somente leitura (nenhuma alteração de código, banco, dados, secrets ou produção)
**Fonte da verdade:** código do projeto aberto no Lovable + consultas read-only ao banco (Lovable Cloud) + execução de typecheck, lint e runner de testes.

> Convenções de segurança adotadas neste relatório: nenhum valor de variável de ambiente, token, chave ou senha é exibido. Apenas nome, uso e estado (configurada / ausente / obsoleta). IDs de projeto são omitidos ou mascarados.

---

## 2. RESUMO EXECUTIVO

### Estado geral
O produto é um app financeiro pessoal/MEI/empresa em **TanStack Start v1 + React 19 + Lovable Cloud (Postgres/Supabase)**, já publicado em domínio próprio (`gastointeligente.com.br`), com **20 usuários reais em `auth.users`**, **dados financeiros reais em produção** (124 gastos, 124 receitas, 19 contas a pagar, 8 pagamentos de assinatura) e **150 migrations aplicadas**.

O núcleo financeiro web está maduro e utilizável. A frente de **WhatsApp** está tecnicamente construída em profundidade (87 módulos server, 124 arquivos de teste, 2249 testes verdes) mas **desligada por segurança em todos os níveis** (env + runtime no banco + quotas zeradas + templates em `draft`). O **Mercado Inteligente** existe em versão básica funcional e avançada parcial. **Empresa Inteligente** está implementada em código mas com **zero registros** no banco (nunca exercitada em produção). **PWA e Android não existem** no repositório.

### Percentual aproximado de conclusão (ponderado por interface + backend + banco + segurança + dados reais + testes + produção)

| Frente | Conclusão estimada |
|---|---|
| Núcleo financeiro (gastos, receitas, contas, cartões, metas, orçamento) | **85%** |
| Planos, Mercado Pago e assinaturas | **70%** |
| Importações e OCR | **75%** |
| Gasto AI | **70%** |
| Mercado Inteligente (básico) | **75%** |
| Mercado Inteligente (avançado / Joanin / normalização) | **40%** |
| Empresa Inteligente | **55%** (código sem uso real) |
| WhatsApp inbound | **80%** (pronto, desligado) |
| WhatsApp outbound / notificações | **60%** (bloqueado por Meta) |
| PWA / Android / biometria | **20%** |
| Segurança e LGPD | **75%** |
| **Média ponderada do projeto** | **≈ 68%** |

### Módulos que já podem ser utilizados
Gastos, Receitas, Contas a pagar/receber, Cartões e faturas, Metas, Orçamento, Guardado/Cofre, Investimentos, Categorias, Relatórios, Importações (PDF/imagem/CSV), Gasto AI, Mercado básico (listas/carrinho/orçamento), Landing/checkout Mercado Pago.

### Módulos que ainda NÃO devem ser liberados
WhatsApp outbound (templates não aprovados), Dispatcher/cron, Mercado avançado com preço comunitário aberto ao público, Empresa Inteligente para clientes pagantes (nunca exercitada), Biometria/Android (inexistente).

### Principais riscos
1. **Dados reais contaminados por dados de teste** — a soma de `receitas` é **R$ 666.667.182.417** por causa de 12 registros de valor 5.555.555.555,00 com descrição "5555". Isso corrompe dashboard, relatórios e qualquer métrica.
2. **Nenhum `cron.job` agendado** no banco, apesar de `pg_cron` instalado — os lembretes e o dispatcher não têm agendamento ativo (coerente com o modo OFF, mas é um item de cutover).
3. **`payment_events` está vazio (0 linhas)** enquanto `subscription_payments` tem 8 — o pipeline atômico novo de billing (`billing_apply_mercadopago_event_atomic`) **nunca processou um evento real**.
4. **Vulnerabilidade crítica de dependência** (`seroval` via `@tanstack/*`, GHSA-mv8w-475r-vwqw).
5. **13.907 erros de ESLint** (99% `prettier/prettier`) — ruído que esconde problemas reais; 116 `no-explicit-any`.
6. **Nenhuma tabela usa FORCE RLS**, exceto `whatsapp_meta_templates` e `whatsapp_notifications`.
7. `cnpj_cache` tem **0 policies** com RLS ligado (correto: acesso só via service_role) — mas o mesmo padrão precisa ser confirmado tabela a tabela.

### Principais bloqueadores
- Aprovação dos 3 templates PT-BR pela Meta (externo).
- Higienização dos dados de teste em produção (interno, exige decisão do dono).
- Definição de quotas reais por plano (hoje todas em `phase3_beta_zero` / zero para free e pessoal_manual).
- Ausência de PWA/manifest/service worker.

### Dependências externas
Meta (templates/WABA), Mercado Pago, Lovable AI Gateway, BrasilAPI, Joanin Online (scraping público), Google Maps/Vision, Google Search Console.

### Partes que parecem prontas visualmente, mas não estão completas
- **Empresa Inteligente**: rotas `/empresa`, `/clientes`, `/fornecedores`, `/contador` existem e renderizam, mas `user_companies`, `clientes` e `fornecedores` têm **0 registros**.
- **Investimentos**: 11 rotas completas, `investimentos_ativos` com **0 registros**.
- **Mercado avançado**: `mercado_cestas_padrao` = 0, `merchant_brand_aliases` = 0 (normalização de marca **não tem dados**).
- **WhatsApp**: painel admin completo, mas runtime 100% OFF.

### Cinco próximas ações mais importantes
1. Higienizar/quarentenar os 12 registros de receita fictícia (R$ 5,5 bi) e revisar demais dados de QA em produção.
2. Fechar o ciclo Mercado Pago ponta a ponta em sandbox e confirmar gravação em `payment_events`.
3. Submeter os 3 templates à Meta (Turno 4C) e acompanhar aprovação.
4. Definir e aplicar quotas reais em `whatsapp_plan_quotas` para os planos pagos + popular `whatsapp_beta_access`.
5. Atualizar `@tanstack/*` para corrigir a CVE do `seroval` e rodar `prettier --write` para zerar o ruído de lint.

---

## 1. IDENTIFICAÇÃO DO PROJETO

| Item | Estado |
|---|---|
| Framework | TanStack Start v1 (`@tanstack/react-start` 1.167.x, `react-router` 1.168.x), Vite 7 |
| Runtime de produção | Cloudflare Workers (`wrangler.jsonc`, `nodejs_compat`, compat date 2025-09-24) |
| Linguagens | TypeScript, SQL (PL/pgSQL), TSX |
| UI | React 19, Tailwind v4, shadcn/Radix (30+ pacotes), Recharts, Framer Motion, Sonner |
| i18n | i18next + react-i18next, locales `pt` e `en`, 34 namespaces cada |
| Banco | Lovable Cloud (Postgres). **68 tabelas** em `public`, **71 funções** (63 `SECURITY DEFINER`), **150 migrations** |
| Extensões | plpgsql, pg_stat_statements, uuid-ossp, pgcrypto, supabase_vault, pg_net, pg_cron, pgmq |
| Auth | Lovable Cloud Auth (e-mail/senha + recuperação). **20 usuários**. `user_roles` separado (14 linhas), `has_role` SECURITY DEFINER |
| Pagamentos | Mercado Pago (checkout, webhook, OAuth de integração, diagnostics) |
| WhatsApp | Meta Cloud API, Graph **v20.0** centralizada. **Desligado** |
| Server-side | `createServerFn` + 20 rotas de API em `src/routes/api/` (nenhuma Edge Function Supabase) |
| Edge Functions (Supabase) | **NÃO EXISTEM** — arquitetura usa TanStack server routes |
| Jobs/crons | `pg_cron` instalado; **nenhum job em `cron.job`** |
| Storage | 3 buckets: `metas-covers` (privado), `avatars` (público), `mercado-product-images` (público) |
| Domínio | `gastointeligente.com.br` + `www` (custom domain ativo) + `gasto-facil-financeiro.lovable.app` |
| Analytics | Google Tag Manager `GTM-MCF5CMWP` em `src/routes/__root.tsx`; GA4 apenas dentro do contêiner |
| Ambientes | **Um único banco acessível** (preview e produção compartilham o mesmo projeto Cloud) |
| Rotas | 106 arquivos em `src/routes/` |
| Módulos server | 87 arquivos em `src/server/` |
| Testes | 124 arquivos, runner único `scripts/test-whatsapp.mjs` |

**Não foi possível validar pelo Lovable:** aplicativo Android nativo, publicação na Google Play, configuração real do painel Meta Business, painel do Mercado Pago, DNS externo.

---

## 3. MATRIZ COMPLETA DE FUNCIONALIDADES

| Área | Funcionalidade | Status | Interface | Backend | Banco | Segurança | Testes | Produção | Evidência | O que falta |
|---|---|---|---|---|---|---|---|---|---|---|
| Financeiro | Gastos (CRUD, categorias, recorrência, parcelas) | CONCLUÍDO | Sim | Sim | 124 linhas | RLS 8 pol. | Indireto | Sim | `src/routes/gastos.tsx`, tabela `gastos` | Testes unitários próprios de UI |
| Financeiro | Receitas | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | 124 linhas | RLS 8 pol. | Indireto | Sim | tabela `receitas` | **Dados fictícios de R$ 5,5 bi poluindo somas** |
| Financeiro | Contas a pagar | CONCLUÍDO | Sim | Sim | 19 linhas | RLS 8 pol. | Sim | Sim | `contas-a-pagar.*.tsx`, `whatsapp_baixa_conta_atomic` | — |
| Financeiro | Contas a receber | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | 2 linhas | RLS 8 pol. | Parcial | Sim | `contas-a-receber.*.tsx` | Uso real quase nulo; relatórios não exercitados |
| Financeiro | Cartões e faturas | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | 5 cartões / 1 fatura | RLS 8 pol. | Parcial | Sim | `src/server/cartao-fatura.server.ts`, `cartao-limite`, `cartao-parcelamento` | Baixo volume real; pagamento de fatura pouco exercitado |
| Financeiro | Assinaturas recorrentes | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | `recorrencias` 17 | RLS 8 pol. | Parcial | Sim | `assinaturas.*.tsx`, tabela `recorrencias` | Reanálise automática não confirmada |
| Financeiro | Orçamento | CONCLUÍDO | Sim | Sim | `limites` 7 | RLS 8 pol. | Parcial | Sim | `orcamento.tsx`, tabela `limites` | Histórico entre meses |
| Financeiro | Metas | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | 5 metas / 0 movimentações | RLS 8 pol. | Parcial | Sim | `metas.*.tsx`, `movimentacoes_meta` | `movimentacoes_meta` = 0: contribuições nunca usadas |
| Financeiro | Guardado / Cofre | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | `dinheiro_guardado` 10, `vault_entries` 14 | RLS 4 pol. + PIN | Parcial | Sim | `guardado.tsx`, `app_.cofre-pessoal.tsx`, `src/lib/vault/crypto.ts` | Auditoria de criptografia do cofre |
| Financeiro | Investimentos | APENAS INTERFACE (na prática) | Sim (11 rotas) | Sim | **0 ativos** | RLS 8 pol. | Não | Publicado | `investimentos.*.tsx`, `investimentos_ativos` | Nenhum uso real; rentabilidade não validada com dados |
| Financeiro | Transferências internas | APENAS BANCO/BACKEND | Parcial | Sim | 0 linhas | RLS 8 pol. | Não | — | `transferencias_internas` | UI e uso real |
| Dashboard | Cards, gráficos, calendário | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | Sim | — | Não | Sim | `src/routes/app.tsx`, `resumo.tsx` | Verificação de boundaries de mês/fuso (ver §5) |
| IA | Gasto AI | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | `ai_chat_messages` 2 | RLS 3 pol. | Não | Sim | `src/routes/gasto-ai.tsx`, `src/lib/finance-ai.functions.ts` | Apenas 2 mensagens: uso real ≈ nulo; sem métrica de custo |
| Import | Extrato / fatura / conta / investimentos (PDF, imagem, CSV) | CONCLUÍDO | Sim | Sim | `imported_transactions` 752, `extratos_importados` 2 | Rate limit + auth | Parcial | Sim | `src/routes/api/import-*.ts` | Retenção/expurgo formal |
| Import | Cupom fiscal (NFC-e) | PARCIAL | Sim | Sim | — | — | Não | Sim | `src/lib/mercado/nfce-*.ts`, `mercado_.importar-cupom.tsx` | Cobertura de SEFAZ por estado |
| Empresa | Empresa Inteligente | APENAS INTERFACE (na prática) | Sim | Sim | **`user_companies` 0, `clientes` 0, `fornecedores` 0** | RLS 4-8 pol. | Não | Publicado | `empresa.tsx`, `clientes.tsx`, `fornecedores.tsx`, `contador.tsx`, `src/server/cnpj.server.ts` | Nunca exercitada; `cnpj_cache` 1 linha |
| Mercado | Listas, carrinho, orçamento | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | `mercado_listas` 1, `mercado_orcamentos` 0 | RLS 4 pol. | Não | Sim | `mercado_.listas*`, `mercado_.carrinho` | Uso real baixíssimo |
| Mercado | Histórico de compras/preços | PARCIAL | Sim | Sim | `mercado_historico_compras` 3, `mercado_precos_usuario` 112 | RLS 4 pol. | Não | Sim | `mercado_.historico`, `precos-historico` | Volume insuficiente para comparações |
| Mercado | Preço comunitário | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | 378 linhas (último 2026-06-10) | RLS 4 pol., campo `status`/`confidence` | Não | Sim | `community_market_prices`, `mercado_.preco-comunitario.tsx` | Moderação/denúncia não confirmadas na UI |
| Mercado | Cesta padrão | PLANEJADO SEM IMPLEMENTAÇÃO (dados) | Sim | Sim | **0 linhas** | RLS 4 pol. | Não | — | `mercado_cestas_padrao`, `mercado_.cesta.tsx` | Popular cesta de referência |
| Mercado | Importação Joanin | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | Alimenta `community_market_prices` | Auth + rate limit + whitelist de host/imagem | Não | Sim | `src/routes/api/mercado-joanin-import.ts` (427 linhas), `OnlineImportWizard.tsx` (746) | Sem job agendado; URLs `/p/<placement>` não suportadas |
| Mercado | Carrefour | NÃO LOCALIZADO | Não | Não | Não | — | Não | — | Só aparece como string em `categories.ts`, `brand/resolver.ts`, `csv-fatura.ts` | Tudo |
| Mercado | Normalização de produtos | PARCIAL | — | Sim | `merchant_brand_aliases` **0** | RLS 5 pol. | Não | — | `product-name-clean.ts`, `product-image-key.ts`, coluna `normalized_product_name` | Produto canônico, GTIN/EAN, score de matching, revisão manual |
| WhatsApp | Inbound (texto/áudio/imagem/PDF) | DESATIVADO POR SEGURANÇA | Sim | Sim | `whatsapp_messages` 269 (últ. 2026-07-12) | HMAC + gates | 2249 testes | OFF | `src/server/whatsapp.server.ts`, runtime `inbound_enabled=false` | Ligar flags após beta |
| WhatsApp | Outbound / notificações | BLOQUEADO | Admin sim | Sim | `whatsapp_notifications` 1 (`processing`) | Early-exit duplo | Sim | OFF | `public.hooks.whatsapp-dispatcher.ts` | Aprovação Meta |
| WhatsApp | Templates Meta | INICIADO | Admin | Sim | 3 linhas em **`draft`**, `provider_template_id` nulo | FORCE RLS | Sim | OFF | `whatsapp_meta_templates` | Submissão (Turno 4C) |
| WhatsApp | Quotas por plano | FUNCIONAL COM PENDÊNCIAS | Admin | Sim | 8 linhas | RPC atômica | Sim | OFF | `whatsapp_plan_quotas` | free/free_ads/pessoal_manual/sem_assinatura = **0 em tudo** |
| WhatsApp | Beta access | PLANEJADO SEM IMPLEMENTAÇÃO (dados) | Admin | Sim | **0 linhas** | RLS 1 pol. | Sim | OFF | `whatsapp_beta_access` | Popular lista de beta |
| Pagamentos | Checkout Mercado Pago | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | `subscription_payments` 8 | HMAC webhook | Parcial | Sim | `api/checkout.create.ts`, `checkout.verify.ts` | Ver `payment_events`=0 |
| Pagamentos | Webhook + billing atômico | INICIADO | — | Sim | **`payment_events` 0** | HMAC | Sim | Publicado | `public.webhooks.mercadopago.ts`, `billing_apply_mercadopago_event_atomic` | Nunca executado com evento real |
| Pagamentos | Integração MP do usuário (OAuth) | PARCIAL | Sim | Sim | `user_integrations` 1 | RLS 4 pol. | Não | Sim | `api/integrations.mercadopago.*` | Volume real ~zero |
| Plataforma | Admin (saúde, whatsapp-runtime) | CONCLUÍDO | Sim | Sim | `whatsapp_runtime_config` + audit | Admin Master | Sim | Sim | `admin_.saude.tsx`, `admin_.whatsapp-runtime.tsx` | — |
| Plataforma | Radar econômico | FUNCIONAL COM PENDÊNCIAS | Sim | Sim | `economic_indicators` 4 | RLS 1 pol. | Não | Sim | `src/server/radar.server.ts`, `api/economic-radar.ts` | Atualização agendada |
| Plataforma | E-mails transacionais | PARCIAL | — | Sim | `email_send_log` 0 | RLS 3 pol. | Não | — | `src/routes/email`, `email_send_state` | Nunca enviou |
| Plataforma | Contas conectadas (Open Finance) | APENAS INTERFACE | Sim | Parcial | 0 linhas | 6 pol. + triggers WA-SEC-CA-01 | Sim | — | `contas-conectadas.tsx`, `connected_accounts` | Provedor real |
| Plataforma | Anúncios (free_ads) | FUNCIONAL COM PENDÊNCIAS | Sim | — | — | — | Sim | Sim | `.env.production`, `tests/e2e/free-ads.spec.ts` | Client AdSense real |
| App | PWA / manifest / service worker | NÃO LOCALIZADO | Não | — | — | — | Não | — | `public/` sem `manifest.json`/`sw.js` | Tudo |
| App | Android nativo | NÃO FOI POSSÍVEL VALIDAR | — | — | — | — | — | — | Fora do repositório | Acesso ao projeto Android |
| App | Biometria | PARCIAL | Sim | — | — | — | Não | — | `src/lib/biometric-login.ts`, `src/lib/vault/quick-unlock.ts` | Ver §14 |

---

## 4. MÓDULOS FINANCEIROS (detalhe)

### 4.1 Gastos — **CONCLUÍDO**
CRUD completo (`gastos.tsx`, `gastos.$id.editar.tsx`, `adicionar.tsx`), categorias (`categorias` 960 linhas, `aprendizado_categoria` 97), contas/cartões vinculados, recorrência (`recorrencias`), parcelamento (`cartao-parcelamento.server.ts` + `whatsapp-parcelamento.server.ts`), anexos via storage, filtros e relatórios (`relatorios.tsx`). Isolamento por `user_id` com 8 policies. Integração WhatsApp e importações confirmadas. **Falta:** testes de UI dedicados.

### 4.2 Receitas — **FUNCIONAL COM PENDÊNCIAS**
CRUD (`renda.*`), recorrência, origem, cliente, conta. Separação pessoal × faturamento empresarial existe no i18n (`renda.json` com `title_mei`/`title_empresa`) e em `plans.ts` (`recursos_mei`, `recursos_empresa`). **Pendência crítica:** 12 registros com valor 5.555.555.555,00 e descrição "5555" criados em 2026-05-05 distorcem a soma total para R$ 666,6 bilhões.

### 4.3 Contas a pagar — **CONCLUÍDO**
Cadastro/edição/exclusão/baixa, vencimento e atraso (`contas-vencimento.server.ts`, `resolveNextOccurrence`), recorrência, fornecedor, boleto (OCR), anexos, alertas (`user_alerts` 31), notificações WhatsApp (desligadas), idempotência via `whatsapp_baixa_conta_atomic`.

### 4.4 Contas a receber — **FUNCIONAL COM PENDÊNCIAS**
Rotas completas incluindo `$id.receber`. Apenas 2 registros: fluxo de atraso/relatório e associação empresarial **não exercitados em produção**.

### 4.5 Cartões e faturas — **FUNCIONAL COM PENDÊNCIAS**
`cartao-limite.server.ts` (limite), `cartao-fatura.server.ts` (fechamento/vencimento/fatura), `cartao-parcelamento.server.ts`. Deduplicação em `ImportFaturaDialog.tsx`. Volume real baixo (5 cartões, 1 fatura) — cálculos de fatura pouco validados com dados reais.

### 4.6 Assinaturas recorrentes — **FUNCIONAL COM PENDÊNCIAS**
`assinaturas.index/nova/$id.editar`, tabela `recorrencias` (17). Controle por plano via `assinaturas_recorrencias` em `plans.ts`. Identificação automática e reanálise: não evidenciadas.

### 4.7 Orçamento — **CONCLUÍDO**
`orcamento.tsx` + `limites` (7). Consumido/percentual/restante/alertas presentes. Histórico entre meses é o ponto fraco.

### 4.8 Metas — **FUNCIONAL COM PENDÊNCIAS**
5 metas, capas em bucket privado `metas-covers`, `MetaArt.tsx`/`MetaCover.tsx`. **`movimentacoes_meta` = 0**: contribuições e progresso nunca foram usados de verdade. Gate `metas_visuais` × `metas_basico` em `plans.ts`.

### 4.9 Guardado e Cofre — **FUNCIONAL COM PENDÊNCIAS**
`dinheiro_guardado` (10), `vault_entries` (14), `vault_pin_settings`, `vault_settings`, criptografia client-side em `src/lib/vault/crypto.ts` e desbloqueio rápido em `quick-unlock.ts`. Recomenda-se auditoria criptográfica dedicada.

### 4.10 Investimentos — **APENAS INTERFACE na prática**
11 rotas (novo, editar, movimentação, rendimento, atualizar-lote, importar, importações). 5 tabelas com **0 linhas** (exceto `investimentos_atualizacoes` = 1). Importação por IA existe (`api/import-investimentos.ts` com Gemini). Rentabilidade e relatórios **não validados com dados reais**.

---

## 5. DASHBOARD E CALENDÁRIO — **FUNCIONAL COM PENDÊNCIAS**

Cards, saldos, gráficos (Recharts), comparações mensais, próximos vencimentos, alertas (`DashboardAlertasBloco.tsx`), insights de cartão (`DashboardCartoesInsights.tsx`), estados vazios e loading presentes; i18n pt/en completo.

**Sobre a divergência de contagem mensal (ex.: abril × maio):** a auditoria estática confirma uso de `date-fns` e filtros por intervalo, mas **não foi possível validar** que todas as consultas usem consistentemente `startOfMonth`/`endOfMonth` no fuso do usuário — há mistura de comparação por `timestamptz` (UTC) e por `date`. Registros criados perto da virada do mês em UTC-3 podem cair no mês seguinte. **Recomendação (não executada):** normalizar todas as consultas mensais para o fuso `America/Sao_Paulo` em uma única função utilitária, e comparar `>= inicio` e `< inicioProximoMes`. Os 12 registros de receita fictícia de 2026-05-05 amplificam qualquer diferença percebida entre abril e maio.

---

## 6. GASTO AI — **FUNCIONAL COM PENDÊNCIAS**

- Interface: `src/routes/gasto-ai.tsx`; backend: `src/lib/finance-ai.functions.ts`; histórico em `ai_chat_messages` (RLS 3 policies, **2 linhas**).
- Provedor: **Lovable AI Gateway** (`LOVABLE_API_KEY` configurada). Modelos observados no código: `google/gemini-*` (OCR, extratos, faturas, contas, investimentos, encartes) e `openai/gpt-*` (transcrição de áudio do WhatsApp, `whatsapp-transcription.server.ts`).
- Rate limit: `src/server/rate-limit.server.ts` com `pg_advisory_xact_lock` (atômico) e tabela `rate_limit_events` (2.750 linhas — em uso real).
- Controle por plano: feature `gasto_ai` em `plans.ts`.

**IA real vs. regras fixas:**
- **IA real:** Gasto AI (chat), OCR de boleto (`whatsapp-boleto-ocr.server.ts`), OCR de comprovante, importação de extrato/fatura/conta/investimentos, OCR de encarte (`mercado-flyer-ocr.ts`), transcrição de áudio.
- **Regras fixas (não-IA):** parser de gasto/receita/Pix/boleto por regex (`whatsappParser.ts`, `whatsapp-pix-parser.ts`, `whatsapp-boleto-parser.ts`), categorização por `aprendizado_categoria` e `whatsapp_merchant_category_memories`, radar econômico, alertas, cálculos de fatura/limite.

**Faltando:** registro de custo por chamada, cota por usuário no Gasto AI (existe rate limit, não orçamento), política explícita de privacidade sobre o que é enviado ao provedor.

---

## 7. IMPORTAÇÃO DE DOCUMENTOS

| Formato | Rota | Estado real |
|---|---|---|
| Extrato PDF/CSV | `api/import-extrato.ts` | **Funciona** (752 linhas em `imported_transactions`) |
| Fatura PDF | `api/import-fatura-pdf.ts` | **Funciona** (Gemini) |
| Fatura imagem | `api/import-fatura-imagem.ts` | **Funciona** (Gemini) |
| Conta (imagem) | `api/import-conta.ts` | Funciona |
| Conta PDF | `api/import-conta-pdf.ts` | Funciona |
| Investimentos | `api/import-investimentos.ts` | Implementado, **0 importações reais** |
| Comprovante | `src/server/ocr-comprovante.server.ts` | Funciona (via WhatsApp e web) |
| Boleto | `whatsapp-boleto-ocr.server.ts` + cache LRU | Funciona (validado com C6/336) |
| Cupom fiscal NFC-e | `src/lib/mercado/nfce-*.ts` | **Parcial** — depende de portal estadual |
| Encarte de mercado | `api/mercado-flyer-ocr.ts` | Parcial |

Validações presentes: tipo real do arquivo (`whatsapp-media-validation.server.ts`, `whatsapp-pdf-validation.server.ts`), tamanho, sanitização (`whatsapp-media-sanitize.server.ts`), rate limit por usuário, dedupe por `batchId`/hash em `ImportExtratoDialog.tsx`. **Faltando:** política formal de retenção/expurgo, painel de custo de OCR.

---

## 8. EMPRESA INTELIGENTE — **APENAS INTERFACE na prática**

- Código presente: `empresa.tsx`, `clientes.tsx`, `clientes_.relatorio.tsx`, `fornecedores.tsx`, `fornecedores_.relatorio.tsx`, `contador.tsx`, `aceitar-convite.$token.tsx`, `src/server/cnpj.server.ts`, `cnpj_cache`.
- Consulta CNPJ via BrasilAPI com cache — `cnpj_cache` tem **1 linha** e **0 policies** (acesso apenas `service_role`, hardening WA-SEC aplicado).
- **`user_companies` = 0, `clientes` = 0, `fornecedores` = 0.** Nenhuma empresa foi cadastrada em produção; a regra de "uma empresa principal por usuário" **não pôde ser validada com dados**.

**Prontidão por perfil:** Pessoa física — **pronto**. MEI — **código pronto, não exercitado**. Empresa — **código pronto, não exercitado**.

---

## 9. MERCADO INTELIGENTE

### 9.1 Básico — **FUNCIONAL COM PENDÊNCIAS**
Listas (`mercado_.listas`, `mercado_listas` = 1), carrinho, orçamento (`mercado_orcamentos` = 0), calculadoras, produtos/quantidades/unidades. Stores locais em `src/lib/mercado/*-store.ts`. Histórico: `mercado_historico_compras` = 3.

### 9.2 Avançado — **PARCIAL**
Mercados salvos (3), histórico de preços (`mercado_precos_usuario` = 112), comparação, preço comunitário (378), localização (Google Maps via `nearby-markets-api.ts`), importação de cupom. **Cesta padrão = 0 linhas.**

### 9.3 Joanin — **FUNCIONAL COM PENDÊNCIAS**
- Arquivos: `src/routes/api/mercado-joanin-import.ts` (427 linhas), `src/components/mercado/OnlineImportWizard.tsx` (746), `src/lib/mercado/image-url-whitelist.ts`, `product-image-persist.ts`, `community-prices-from-purchase.functions.ts`, i18n pt/en, 2 migrations (`20260601200320`, `20260602044433`).
- Escopo implementado: leitura SSR pública de `joaninonline.com.br` (host allowlist), cap de 120 itens, timeout 15s, sem cookies/fingerprint, sem download de imagens, auth obrigatória + rate limit + gate premium.
- Grava em `community_market_prices` (`source`, `market_name`, `image_url`, `image_source`, `brand`, `barcode`, `confidence`, `status`).
- **Última carga identificável: 2026-06-10** (378 preços acumulados).
- **Quebrado/ausente:** URLs `/p/<placement>` (skeleton client-side) retornam importação parcial; não há job agendado; sem histórico de execução/log dedicado; sem deduplicação canônica entre importações.
- **Falta p/ produção:** agendamento, observabilidade de execução, dedupe por produto canônico, política de expiração (`valid_until`).

### 9.4 Carrefour — **NÃO LOCALIZADO**
Nenhum adapter, função, tabela, migration, TODO ou dado. As ocorrências ("Carrefour") são apenas listas de merchants em `src/lib/categories.ts`, `src/lib/brand/resolver.ts`, `src/lib/csv-fatura.ts` e `whatsapp-comprovantes.server.ts` — reconhecimento de nome, **não integração**.

### 9.5 Preço comunitário — **FUNCIONAL COM PENDÊNCIAS**
Tabela com `user_id`, `market_name`/`market_id`, `city`, `neighborhood`, `seen_at`, `valid_until`, `confidence`, `status`, `notes`, `source`. RLS 4 policies. **Faltando:** fluxo de moderação e denúncia na UI, detecção de outliers, regra de duplicidade.

### 9.6 Normalização de produtos — **PARCIAL**
Existe: `normalized_product_name`, `brand`, `barcode` (campo GTIN/EAN presente), `normalizeForKey()` em `product-image-key.ts`, `product-name-clean.ts`, tabela `merchant_brand_aliases`.
**Não existe:** tabela de produto canônico, matching com score de confiança, unidade/peso/volume estruturados, fila de revisão manual. `merchant_brand_aliases` tem **0 linhas** — o caso "Coca-Cola 2L / Coca Cola PET 2 litros / Refrigerante Coca-Cola Original 2L" **não é resolvido hoje**.

---

## 10. WHATSAPP

### 10.1 Meta Cloud API
| Item | Estado |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Configurada |
| `WHATSAPP_APP_SECRET` | Configurada (validação HMAC do webhook) |
| `WHATSAPP_VERIFY_TOKEN` | Configurada |
| `WHATSAPP_PHONE_NUMBER_ID` | Configurada |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Configurada |
| `WHATSAPP_WABA_ID` | **Referenciada no código, AUSENTE na lista de secrets** — possível duplicidade/obsolescência com `WHATSAPP_BUSINESS_ACCOUNT_ID` |
| `WHATSAPP_GRAPH_VERSION` | Configurada — código exige exatamente `v20.0` (`whatsapp-graph-version.server.ts`, fail-closed) |
| Webhook | Implementado com HMAC + replay guard (`tests/whatsapp-webhook-replay-3-27.test.ts`) |
| Callbacks de status | Implementados (`whatsapp-meta-status-callbacks.server.ts`) com CAS anti-regressão |
| Permissões da conta Meta | **NÃO FOI POSSÍVEL VALIDAR** (exige painel Meta) |

### 10.2 Entrada de mensagens — implementada, **desligada**
Texto, áudio (Whisper/GPT + `WHATSAPP_AUDIO_ENABLED`), imagem, PDF, boleto, Pix, gastos, receitas, contas, parcelamentos, consultas, confirmações ("sim"), cancelamentos, edições, usuários não vinculados, Admin Master, canary, rate limit, idempotência e concorrência (readback guard, `atualizarSessaoOuFalhar`, `claim_token`). 269 mensagens históricas, última em **2026-07-12**.

### 10.3 Fluxos financeiros (todos implementados e testados; **operacionalmente OFF**)
Cadastrar gasto ✅ · Cadastrar receita ✅ · Criar conta a pagar ✅ · Editar conta ✅ · Marcar conta como paga ✅ (RPC atômica) · Criar parcelamento ✅ (trava `parc_persistindo`) · Interpretar boleto ✅ · Consultar favorecido ✅ · Consultar Pix ✅ · Confirmar por "sim" ✅ · Cancelar operação ✅.

### 10.4 Boleto
Foto e PDF, linha digitável e código de barras com DV, OCR Gemini com cache LRU, valor, vencimento, **banco emissor persistido** (`whatsapp-boleto-banco.ts`, validado em `tests/whatsapp-boleto-banco-emissor-c10-4.test.ts`), beneficiário, anexo, dedupe por fingerprint (`WHATSAPP_BOLETO_FINGERPRINT_SECRET`), rate limit fail-closed.

### 10.5 Pix
Favorecidos e chaves com criptografia (`WHATSAPP_PIX_KEY_ENC_SECRET`), tokens temporários de revelação (`whatsapp_pix_reveal_tokens`, `pix.copiar.$token.tsx`), expiração, link autenticado, cópia facilitada, logs sem PII.

### 10.6 Notificações e dispatcher
Fila `whatsapp_notifications` (**1 linha presa em `processing`** — resíduo da canary), tentativas em `whatsapp_notification_attempts`, status events, dedupe, claim/lease com `claim_token`, recovery de `processing` preso, retry, quiet hours 21h–07h, opt-out (`whatsapp-optout.server.ts`), feature flags, canary, callbacks.

**Risco de dois dispatchers/dois crons:** mitigado por claim atômico com ownership token; além disso **não há nenhum job em `cron.job`** hoje, então não há disparo automático. O risco real reaparece se o cron for criado em dois ambientes apontando para o mesmo banco.

### 10.7 Templates Meta
| Template | No código | No banco | Status | Idioma | Categoria | Provider ID |
|---|---|---|---|---|---|---|
| `gi_conta_vencendo_hoje_v1` | Sim (allowlist) | Sim | **draft**, `active=false` | pt_BR | UTILITY | nulo |
| `gi_conta_vencendo_amanha_v1` | Sim | Sim | **draft**, `active=false` | pt_BR | UTILITY | nulo |
| `gi_conta_atrasada_v1` | Sim | Sim | **draft**, `active=false` | pt_BR | UTILITY | nulo |
| Canary (`gi_teste_integracao_canary`) | Sim | Em `whatsapp_notification_templates`, `active=true` | mapeado para `hello_world` | — | — | — |
| `hello_world` | Referenciado como `meta_template_name` da canary | Sim | Template padrão da Meta | en_US | UTILITY | — |

Em `whatsapp_notification_templates` existem ainda `gi_conta_recorrente_pendente` (ativo, **sem** `meta_template_name`). Os 3 templates produtivos têm `meta_template_name = NULL`.

**Onde a ativação parou:** exatamente no **Turno 4C — submissão real à Meta**. O catálogo local, o resolver fail-closed, o cliente de management, o fingerprint SHA-256 e o sync read-only estão prontos; nada foi submetido (`provider_template_id` nulo em todos, `submitted_at` nulo).

### 10.8 Variáveis de segurança (somente estado)
| Variável | Estado |
|---|---|
| `WHATSAPP_DISPATCH_ENABLED` | Configurada — parser estrito exige a string `"true"`; runtime confirma modo desligado |
| `WHATSAPP_OUTBOUND_HTTP_ENABLED` | Configurada — mesma trava; dispatcher faz early-exit antes de tocar o banco |
| `WHATSAPP_CANARY_USERS` | Configurada |
| `WHATSAPP_DISPATCHER_SECRET` | Configurada (HMAC `x-cron-signature`) |
| `WHATSAPP_ENABLED`, `WHATSAPP_CANARY_ENABLED`, `WHATSAPP_AUDIO_ENABLED`, `WHATSAPP_REGISTER_LOCK`, `WHATSAPP_REGISTER_PIN` | Configuradas |
| `WHATSAPP_META_MGMT_ENABLED`, `WHATSAPP_META_SUBMISSION_ENABLED`, `WHATSAPP_SESSION_AUDIT_FALLBACK`, `WHATSAPP_WABA_ID` | **Referenciadas no código, ausentes na lista de secrets** → comportam-se como `false`/indefinidas (fail-closed) |

**Runtime persistido no banco (`whatsapp_runtime_config`, atualizado 2026-07-17):** `global_enabled=false`, `inbound_enabled=false`, `outbound_enabled=false`, `notification_creation_enabled=false`, `new_links_enabled=false`, `rollout_enabled=false`, `rollout_percentage=0`, `global_daily_outbound_limit=0`. **Sistema 100% OFF em código e em dados.**

---

## 11. MIGRAÇÃO DO BANCO DE DADOS — **NÃO FOI POSSÍVEL VALIDAR (comparação de dois ambientes)**

**Ambiente acessível:** um único projeto Lovable Cloud (ref mascarado `vnlx…egak`), usado por preview **e** produção — `.env` e `supabase/config.toml` apontam para o mesmo `project_id`, e não existe segundo conjunto de credenciais no repositório.

**Ambiente NÃO acessível:** qualquer banco de origem ou destino distinto. Não há, no projeto, string de conexão, secret, arquivo de configuração ou script que referencie um segundo projeto.

**Conclusão honesta:** **não há evidência no projeto de uma migração entre dois bancos em andamento.** Não é possível comparar tabelas, colunas, enums, índices, constraints, views, triggers, funções, RPCs, extensões, grants, RLS, policies, buckets, contagens, somas financeiras, Auth ou Storage entre origem e destino.

**Para completar a comparação seria necessário:** (a) o ref/URL do segundo projeto; (b) uma credencial de leitura para ele; (c) confirmação de qual é origem e qual é destino.

**Estado do ambiente acessível (baseline para qualquer migração futura):**
- 68 tabelas em `public`, 71 funções (63 SECURITY DEFINER), 150 migrations, 8 extensões.
- 20 usuários em `auth.users`; `profiles` 20; `user_roles` 14; `user_plans` 20.
- 3 buckets de Storage.
- Nenhum `cron.job` agendado.
- `anon` **não possui nenhum grant** em tabelas de `public` (bom sinal de fechamento).

**Riscos de migração (aplicáveis quando ela existir):** UUID de usuário alterado, registros associados ao usuário errado, RLS/policies não replicadas, webhooks Mercado Pago apontando para dois ambientes, dois dispatchers/dois crons, arquivos permanecendo apenas no Storage antigo. **Cutover:** não avaliável sem o segundo ambiente.

---

## 12. MERCADO PAGO E ASSINATURAS — **FUNCIONAL COM PENDÊNCIAS**

- Checkout: `api/checkout.create.ts` + `checkout.verify.ts`; webhook público: `api/public.webhooks.mercadopago.ts` (HMAC via `MERCADO_PAGO_WEBHOOK_SECRET`).
- OAuth de integração do usuário: `api/integrations.mercadopago.connect|callback|$action.ts`; `user_integrations` = 1.
- Billing atômico: `billing_apply_mercadopago_event_atomic` + `src/server/billing-mercadopago-apply.server.ts` (lock advisory por `user_id`, idempotência L1 por unique index, proteção out-of-order por `provider_updated_at`, invalidação de notificações no downgrade).
- Cancelamento imediato × agendado: `mercadopago-cancellation-resolver.server.ts`.
- Diagnóstico: `mercadopago-diagnostics.server.ts`.
- Secrets `MERCADO_PAGO_ACCESS_TOKEN`, `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`, `WEBHOOK_SECRET`: todas configuradas.

**Pendências e riscos:**
- **`payment_events` = 0** e **`subscription_payments` = 8**: os 8 pagamentos são anteriores ao pipeline atômico. O caminho novo **nunca foi exercitado com um evento real** — este é o maior risco de "plano não liberado após pagamento".
- `webhook_logs` = 936 (último 2026-07-20) — há tráfego de webhook chegando; convém auditar quantos são MP e qual `status`.
- Trial de 10 dias: presente em `plans.ts`/UI; não validado com um ciclo real completo.
- Pagamento duplicado / webhook duplicado: mitigados por unique index + advisory lock (testado em `tests/whatsapp-c11-f2-billing.test.ts`).
- Assinatura vinculada ao usuário errado: mitigado por resolução server-side do `user_id`, sem confiar no client.

---

## 13. PLANOS E BLOQUEIOS

**Enum `plan_tier` no banco (11 valores):** `free`, `pessoal`, `mei`, `empresa`, `admin_master`, `pessoal_manual`, `pessoal_premium`, `mei_essencial`, `mei_inteligente`, `sem_assinatura`, `free_ads`.
**Tipo `PlanTier` no código (9 valores):** `free` (deprecated), `sem_assinatura`, `free_ads`, `pessoal_manual`, `pessoal_premium`, `mei_essencial`, `mei_inteligente`, `empresa`, `admin_master`.

**Inconsistência:** `pessoal` e `mei` existem no enum do banco mas **não** no tipo do código (`mei` é tratado como alias legado de `mei_essencial`; `pessoal` não é mapeado explicitamente). Um registro histórico com `plano='pessoal'` cairia em caminho não previsto.

**Distribuição real em `user_plans`:** `free_ads/ativo` 14 · `free/ativo` 3 · `pessoal_manual/ativo` 1 · `pessoal_manual/aguardando_pagamento` 1 · `sem_assinatura` 1. **Nenhum usuário em plano pago premium/MEI/empresa.**

**Quotas WhatsApp (`whatsapp_plan_quotas`):** `free`, `free_ads`, `sem_assinatura`, `pessoal_manual` → **tudo zero** (`phase3_beta_zero`). `pessoal_premium` 150/75 mês, `mei_essencial` 400/150, `mei_inteligente` 900/350, `empresa` 2500/1000 (`phase3_beta_default`). **`pessoal_manual` com zero significa que quem paga o plano manual não terá WhatsApp** — verificar se é intencional.

**Admin Master e "Plano ativo":** `ADMIN_MASTER_EMAILS` configurada; `src/server/admin-master.server.ts` centraliza a checagem; `plans.ts` documenta que permissões derivam do plano efetivo e não de e-mail/UI. O Admin Master permanece marcado como `free` em `user_plans` em alguns casos — daí a exibição inconsistente de "Plano ativo". Recomenda-se derivar o rótulo do plano efetivo (com override de admin) em vez do valor bruto da tabela. **Não corrigido nesta auditoria.**

---

## 14. APLICATIVO ANDROID E PWA

| Item | Estado |
|---|---|
| `manifest.json` / `manifest.webmanifest` | **NÃO LOCALIZADO** em `public/` |
| Service Worker | **NÃO LOCALIZADO** |
| Instalabilidade PWA | **NÃO** (sem manifest nem SW) |
| Ícones | Parcial (`favicon*`, `apple-touch-icon.png`, `og-gasto-inteligente.png`) — faltam ícones 192/512 maskable |
| Responsividade | Sim (`use-mobile.tsx`, `MobileShell`, layout adaptativo) |
| Sessão/cookies/login/logout | Funcionais no web |
| Upload/download | Funcionais |
| Deep links | Rotas file-based servem como deep links; sem intent-filter Android |
| Modo offline | Parcial — existe `src/components/offline/OfflineHistoryDialog.tsx` (histórico offline de UI), **não** cache de aplicação |
| Android nativo | **NÃO FOI POSSÍVEL VALIDAR** — não há código Android no projeto Lovable |

**Biometria — PARCIAL.** Existem `src/lib/biometric-login.ts` e `src/lib/vault/quick-unlock.ts`, referenciados em `login.tsx`, `app.tsx`, `app_.mais.tsx` e `app_.cofre-pessoal.tsx`. **Não há** implementação WebAuthn (`navigator.credentials.create/get`) nem endpoint de challenge/verify no servidor — o que existe é desbloqueio local com PIN/atalho, não autenticação biométrica com prova criptográfica.

**Sobre o problema "digital retorna para a tela de login":** o comportamento é **esperado** com a implementação atual — como não há credencial WebAuthn nem bridge nativa que restaure a sessão, o retorno do prompt biométrico não hidrata sessão do Lovable Cloud, e o `AuthGate` redireciona para `/login`. **Estado: NÃO RESOLVIDO.** Correção exige WebAuthn real (ou bridge Android devolvendo refresh token em armazenamento seguro).

---

## 15. LANDING PAGE E EXPERIÊNCIA COMERCIAL

- `src/routes/index.tsx` é 100% pública (`PublicLanding.tsx`); dashboard vive em `/app`. `/landing`, `/pt`, `/en` redirecionam para `/`.
- Presentes: apresentação, planos e preços, CTAs, cadastro (`/cadastro`), login, blocos de Mercado Inteligente, Importações, Empresa Inteligente e Gasto AI.
- Legal: `/termos`, `/privacidade`, `/lgpd`, `/manual`, `/status`.
- SEO: `sitemap[.]xml.ts`, `robots.txt`, `llms.txt`, `og-gasto-inteligente.png`, meta de verificação do Google Search Console em `index.tsx`, `head()` por rota.
- Analytics: GTM `GTM-MCF5CMWP` no `__root.tsx` (script no head + noscript no body). **Sem Consent Mode** — risco LGPD leve.
- Contato/WhatsApp: `VITE_WHATSAPP_NUMERO_OFICIAL` usada na UI.

**A landing promete funções que ainda não estão prontas?** **SIM, parcialmente:**
- **WhatsApp** é comunicado como recurso, mas está 100% desligado (inbound e outbound).
- **Empresa Inteligente** é apresentada, mas nunca foi usada por nenhum cliente (0 empresas).
- **Investimentos** é apresentado, mas sem nenhum ativo real.
- **Mercado avançado / preço comunitário** funciona, porém com base de dados rasa (378 preços, última carga em junho).

Recomenda-se rotular WhatsApp como "em breve / beta por convite" enquanto o outbound estiver bloqueado.

---

## 16. SEGURANÇA E LGPD

| # | Achado | Classificação | Evidência |
|---|---|---|---|
| S1 | Vulnerabilidade crítica em dependências: `seroval` via `@tanstack/react-router`, `react-start`, `router-plugin` (GHSA-mv8w-475r-vwqw) | **Crítico** | scan de supply chain |
| S2 | Dados fictícios de altíssimo valor em produção (12 receitas × R$ 5,55 bi) distorcendo relatórios financeiros | **Alto** | `receitas`, descrição "5555", 2026-05-05 |
| S3 | Pipeline atômico de billing nunca exercitado (`payment_events`=0) — risco de plano não liberado após pagamento | **Alto** | `payment_events` vs `subscription_payments` |
| S4 | `FORCE RLS` ausente em 66 de 68 tabelas (só `whatsapp_meta_templates` e `whatsapp_notifications` têm) | **Médio** | `pg_class.relforcerowsecurity` |
| S5 | 63 funções `SECURITY DEFINER` — exige revisão contínua de `search_path` e de restrição por `auth.role()` | **Médio** | `pg_proc.prosecdef` |
| S6 | Sem Consent Mode no GTM (cookies/analytics antes de consentimento) | **Médio** (LGPD) | `__root.tsx` |
| S7 | Notificação presa em `processing` desde a canary | **Baixo** | `whatsapp_notifications` |
| S8 | Variáveis referenciadas no código e ausentes nos secrets (`WHATSAPP_WABA_ID`, `WHATSAPP_META_MGMT_ENABLED`, `WHATSAPP_META_SUBMISSION_ENABLED`, `WHATSAPP_SESSION_AUDIT_FALLBACK`, `PUBLIC_SITE_URL`) | **Baixo** | grep em `src/` × `fetch_secrets` |
| S9 | 116 `@typescript-eslint/no-explicit-any` em código server sensível | **Baixo** | eslint |
| S10 | 13.740 violações `prettier/prettier` mascarando sinais reais de lint | **Informativo** | eslint |

**Pontos fortes confirmados:** RLS habilitado em **todas** as 68 tabelas; **zero grants para `anon`**; `user_roles` em tabela separada com `has_role` SECURITY DEFINER; HMAC em webhook MP, dispatcher e callbacks Meta; rate limit atômico com advisory lock; sanitização de erros de transporte sem PII; logs sem PII (`logSanitized`); triggers de imutabilidade em `connected_accounts` (WA-SEC-CA-01B); `cnpj_cache` fechado a `service_role`; tokens Pix temporários com expiração; criptografia do cofre client-side.

**LGPD — lacunas:** exclusão de conta e exportação de dados não localizadas como fluxo de produto; política de retenção documentada apenas para WhatsApp (`docs/whatsapp-retention.md`); consentimento de cookies ausente.

---

## 17. TESTES E QUALIDADE (números reais)

| Comando | Resultado |
|---|---|
| `bunx tsgo --noEmit` | **Exit 0 — 0 erros de tipo** |
| `bun scripts/test-whatsapp.mjs` (runner integral) | **124 arquivos, 2249 testes aprovados, 0 falhos, 0 arquivos com falha, 33,72s** |
| `bunx eslint .` | **13.907 erros / 142 avisos** — `prettier/prettier` 13.740 · `no-explicit-any` 116 · `react-refresh/only-export-components` 73 · sem regra 41 · `no-useless-escape` 36 · `react-hooks/exhaustive-deps` 28 · `prefer-const` 7 · `no-control-regex` 4 |
| Security scan (cache 2026-07-24) | 0 findings em agent_security / app_mcp / connectors / supabase; **1 finding crítico** de supply chain |
| `bun run test:e2e` (Playwright) | **Não executado** — exige app publicado/servidor; fora do escopo seguro desta auditoria |
| Cobertura | **Não disponível** — o runner não coleta cobertura |

Observação: `bun tests/free-ads-plan.test.ts` roda 0 testes no runner (0 pass / 0 fail) — o arquivo é executado como script e não expõe casos ao contador. Item de qualidade, não falha.

**Nada foi executado** que enviasse mensagens, efetuasse pagamentos, alterasse produção, excluísse registros ou disparasse webhooks externos.

---

## 18. CÓDIGO INCOMPLETO

Busca por `TODO|FIXME|HACK|not implemented|placeholder|mock` retorna **1.132 ocorrências**, mas a esmagadora maioria são **falsos positivos em português** (`todos`, `todo mês`, `Todos os tipos`). Ocorrências realmente relevantes:

| Arquivo | Impacto | Módulo | Prioridade | Ação recomendada |
|---|---|---|---|---|
| `whatsapp_runtime_config` (todas as flags false) | Sistema WhatsApp inoperante | WhatsApp | Alta | Ligar após aprovação Meta + beta list |
| `whatsapp_plan_quotas` (4 planos com tudo zero) | Bloqueia usuários pagos do plano manual | Planos | Alta | Definir quotas comerciais |
| `whatsapp_beta_access` (0 linhas) | Beta impossível | WhatsApp | Alta | Popular lista |
| `merchant_brand_aliases` (0 linhas) | Normalização inoperante | Mercado | Média | Popular aliases / criar produto canônico |
| `mercado_cestas_padrao` (0 linhas) | Cesta padrão vazia | Mercado | Média | Popular cesta de referência |
| `src/lib/mercado/api-roadmap.ts` | Documento de intenção, não implementação | Mercado | Baixa | Converter em issues |
| `src/routes/api/mercado-joanin-import.ts` (URLs `/p/`) | Importação parcial silenciosa | Mercado | Média | Suportar ou bloquear explicitamente |
| `src/lib/biometric-login.ts` | Biometria sem WebAuthn | App | Alta | Implementar WebAuthn |
| `email_send_log` (0 linhas) | E-mails nunca enviados | Plataforma | Média | Validar infra de e-mail |
| `transferencias_internas` (0 linhas, sem UI clara) | Feature morta | Financeiro | Baixa | Concluir ou remover |
| Enum `plan_tier` com `pessoal`/`mei` não mapeados no código | Caminho não previsto | Planos | Média | Mapear alias ou depreciar no banco |
| `WHATSAPP_META_MGMT_ENABLED` / `SUBMISSION_ENABLED` ausentes | Submissão à Meta impossível | WhatsApp | Alta | Criar secrets no Turno 4C |

Testes com `skip`: nenhum relevante detectado (0 falhas, 0 skips reportados pelo runner).

---

## 19. DEPENDÊNCIAS EXTERNAS

| Item | Estado | Próxima ação | Impacto | Responsável | Paralelizável |
|---|---|---|---|---|---|
| Aprovação de templates Meta | **Bloqueado — 3 em `draft`, nada submetido** | Submeter (Turno 4C) e aguardar | Bloqueia todo o outbound | Meta / dono | Sim — resto do projeto segue |
| WABA / número oficial | Configurado, não validado por painel | Confirmar status no Meta Business | Bloqueia inbound e outbound | Dono | Sim |
| Mercado Pago | Ativo, pipeline novo não exercitado | Teste ponta a ponta em sandbox | Bloqueia receita | Dev | Sim |
| Lovable AI Gateway | Ativo (`LOVABLE_API_KEY`) | Monitorar custo | Degrada OCR e Gasto AI | Dev | Sim |
| BrasilAPI (CNPJ) | Ativa com cache | Validar fallback manual | Empresa Inteligente | Dev | Sim |
| Joanin Online | Scraping público funcionando | Agendar e observar | Mercado avançado | Dev | Sim |
| Carrefour | Inexistente | Decidir se entra no roadmap | Nenhum hoje | Dono | Sim |
| Domínio / DNS | Ativo (`gastointeligente.com.br` + www) | — | — | — | — |
| Google Search Console | Conector ligado, verificação pendente de propagação | Confirmar verificação e enviar sitemap | SEO | Dev | Sim |
| Google Play | **Não iniciado** | Decidir estratégia (PWA ou TWA) | Distribuição | Dono | Sim |
| Revisão jurídica / LGPD | Textos publicados, sem revisão externa confirmada | Revisão de advogado | Risco legal | Dono | Sim |

---

## 20. PLANO PARA TERMINAR O PROJETO

### Fase 0 — Proteções urgentes
| Tarefa | Prio | Dependência | Risco | Área | Critério de aceite | Paralelo | Terceiros |
|---|---|---|---|---|---|---|---|
| Quarentenar/corrigir as 12 receitas fictícias de R$ 5,55 bi | Crítica | Decisão do dono | Perda de dado se apagado errado | Financeiro | Soma de `receitas` volta a valor plausível | Não | Não |
| Corrigir CVE `seroval` (atualizar `@tanstack/*`) | Crítica | — | Regressão de build | Plataforma | Scan sem finding crítico; runner 2249 verdes | Sim | Não |
| Liberar a notificação presa em `processing` | Alta | — | Baixo | WhatsApp | Fila sem registros órfãos | Sim | Não |
| Rodar `prettier --write` e reduzir lint a <200 erros | Alta | — | Diff enorme | Plataforma | eslint sem `prettier/prettier` | Sim | Não |
| Criar secrets ausentes ou remover referências obsoletas | Alta | — | Baixo | Plataforma | Nenhuma env referenciada sem definição | Sim | Não |

### Fase 1 — Migração do banco
| Tarefa | Prio | Dependência | Risco | Critério de aceite |
|---|---|---|---|---|
| Confirmar se existe migração em andamento e obter acesso ao 2º ambiente | Crítica | Dono | Bloqueio total da fase | Dois refs conhecidos e legíveis |
| Se existir: comparar schema, funções, RLS, grants, buckets | Alta | Acesso | Divergência silenciosa | Diff zero em objetos críticos |
| Comparar contagens e somas financeiras por tabela e por usuário | Alta | Acesso | Dados no usuário errado | Diferença zero |
| Plano de cutover + freeze de escrita + rollback | Alta | Acima | Escrita dupla | Runbook aprovado |

*Se não houver segundo ambiente, esta fase é encerrada como não aplicável.*

### Fase 2 — Núcleo financeiro
Concluir contribuições de metas (`movimentacoes_meta`), validar cálculos de fatura com volume real, unificar as consultas mensais em util único com fuso `America/Sao_Paulo`, exercitar contas a receber e transferências internas, mapear `pessoal`/`mei` no código, corrigir rótulo de "Plano ativo" do Admin Master.

### Fase 3 — WhatsApp
Submeter os 3 templates (Turno 4C) → sincronizar `provider_template_id`/`approved_at` → definir quotas comerciais → popular `whatsapp_beta_access` → ligar `global_enabled`+`inbound_enabled` com `rollout_percentage` baixo → canary outbound → só então `WHATSAPP_DISPATCH_ENABLED` e `WHATSAPP_OUTBOUND_HTTP_ENABLED` → criar **um único** `cron.job` do dispatcher.

### Fase 4 — Mercado Inteligente
Produto canônico + matching com score, popular `merchant_brand_aliases` e `mercado_cestas_padrao`, agendar Joanin com observabilidade, moderação/denúncia de preço comunitário, decisão sobre Carrefour.

### Fase 5 — Aplicativo e PWA
`manifest.webmanifest` + ícones 192/512 maskable + service worker → instalabilidade → WebAuthn real → decisão TWA vs. nativo → publicação.

### Fase 6 — Lançamento
E2E Playwright em CI, monitoramento e alertas de erro, Consent Mode, exclusão de conta e exportação de dados (LGPD), revisão jurídica, ajuste dos textos comerciais da landing.

---

## 21. BLOQUEADORES

| Bloqueador | Área | Gravidade | Impacto | Solução | Dep. externa | Próximo passo |
|---|---|---|---|---|---|---|
| Templates Meta em `draft` | WhatsApp | Crítica | Outbound impossível | Submeter e aguardar | **Sim (Meta)** | Turno 4C |
| Secrets `WHATSAPP_META_MGMT_ENABLED`/`SUBMISSION_ENABLED` ausentes | WhatsApp | Alta | Submissão bloqueada em código | Criar secrets | Não | Criar antes do 4C |
| Dados fictícios de R$ 5,55 bi em `receitas` | Financeiro | Crítica | Relatórios inválidos | Limpeza controlada | Não | Decisão do dono |
| `payment_events` = 0 | Pagamentos | Alta | Plano pode não liberar | Teste ponta a ponta sandbox | Sim (MP) | Executar teste |
| CVE `seroval` | Plataforma | Crítica | Supply chain | Atualizar deps | Não | Bump + runner |
| Quotas zeradas p/ `pessoal_manual` | Planos | Alta | Cliente pagante sem WhatsApp | Definir quotas | Não | Decisão comercial |
| `whatsapp_beta_access` vazio | WhatsApp | Alta | Beta impossível | Popular | Não | Escolher 5–20 usuários |
| Nenhum `cron.job` | Operação | Média | Sem automação | Criar 1 job após go-live | Não | Fase 3 |
| Sem PWA/manifest | App | Média | Sem instalação | Criar manifest+SW | Não | Fase 5 |
| Biometria sem WebAuthn | App | Média | Volta ao login | Implementar WebAuthn | Não | Fase 5 |
| Empresa Inteligente sem uso real | Comercial | Média | Promessa não validada | Piloto com 1 MEI | Não | Recrutar piloto |
| 13.907 erros de lint | Qualidade | Baixa | Ruído | `prettier --write` | Não | Fase 0 |
| Sem Consent Mode | Legal | Média | LGPD | Banner + Consent Mode | Não | Fase 6 |
| Android fora do repo | App | Média | Não auditável | Trazer ou documentar | Sim | Decisão do dono |

---

## 22. RESPOSTAS FINAIS OBRIGATÓRIAS

1. **O sistema pode receber usuários reais hoje?** **SIM.** Já recebe: 20 usuários, RLS em 68/68 tabelas, zero grants para `anon`, typecheck limpo, 2249 testes verdes.
2. **Pode receber pagamentos reais?** **PARCIALMENTE.** Checkout e webhook existem e há 8 pagamentos históricos, mas o pipeline atômico atual nunca processou um evento (`payment_events`=0).
3. **Os dados financeiros estão protegidos?** **SIM.** RLS universal, `anon` sem grants, HMAC em todos os webhooks, rate limit atômico, logs sem PII, cofre criptografado. Ressalva: `FORCE RLS` ausente na maioria das tabelas.
4. **A migração pode continuar?** **NÃO FOI POSSÍVEL VALIDAR.** Só existe um ambiente acessível; nenhum artefato de migração entre dois bancos foi encontrado no projeto.
5. **O banco novo está pronto para cutover?** **NÃO FOI POSSÍVEL VALIDAR** — não há segundo banco identificável.
6. **O WhatsApp pode receber mensagens reais?** **NÃO.** `global_enabled=false` e `inbound_enabled=false` em `whatsapp_runtime_config`.
7. **O WhatsApp pode enviar mensagens reais?** **NÃO.** Early-exit duplo no dispatcher + `outbound_enabled=false` + `global_daily_outbound_limit=0`.
8. **Os templates estão aprovados?** **NÃO.** Os 3 estão `draft`, `active=false`, `provider_template_id` nulo, `submitted_at` nulo.
9. **O dispatcher pode ser ativado?** **NÃO.** Depende de templates aprovados; e nenhum `cron.job` existe.
10. **O Mercado Inteligente está funcional?** **PARCIALMENTE.** Básico funciona; avançado tem dados rasos e normalização vazia.
11. **O Joanin está concluído?** **PARCIALMENTE.** Importa preços reais (378 registros, última carga 2026-06-10), mas sem agendamento, sem dedupe canônica e sem suporte a `/p/<placement>`.
12. **O Carrefour foi iniciado?** **NÃO.** Zero código, tabelas, migrations ou dados — apenas o nome em listas de merchants.
13. **A PWA está pronta?** **NÃO.** Sem manifest e sem service worker.
14. **O Android pôde ser validado?** **NÃO FOI POSSÍVEL VALIDAR** — fora do repositório.
15. **A biometria está concluída?** **NÃO.** Há desbloqueio local por PIN/atalho, sem WebAuthn; o retorno ao login persiste.
16. **Quais módulos possuem apenas interface?** Investimentos, Empresa Inteligente (empresa/clientes/fornecedores/contador), Contas conectadas, Cesta padrão, Transferências internas.
17. **Quais módulos usam dados fictícios?** `receitas` (12 registros de R$ 5,55 bi, descrição "5555") e gastos de teste com descrição "Csa" (R$ 4.000 repetidos). Canary do WhatsApp mapeada para `hello_world`. Nenhum módulo usa mock estático em runtime.
18. **Quais precisam de correção urgente?** Receitas (dados fictícios), dependências (CVE seroval), billing MP (validação ponta a ponta), quotas de plano, secrets ausentes de submissão Meta.
19. **Quais partes podem ser lançadas primeiro?** Núcleo financeiro pessoal + importações + Gasto AI + Mercado básico + landing/checkout. Já estão comercializáveis.
20. **O que impede o lançamento comercial?** Nada impede vender o **site hoje**. Impedem o lançamento **completo**: templates Meta não aprovados, billing atômico não exercitado, dados fictícios em produção e ausência de PWA/Android.
21. **Qual deve ser a próxima tarefa exata?** **Higienizar os 12 registros de receita fictícia em produção**, sob decisão explícita do dono (quarentena com marcação, não exclusão cega), pois eles corrompem dashboard, relatórios e qualquer decisão de negócio baseada nos números.

---

## 23. ESTIMATIVA DE TRABALHO RESTANTE

- **Frentes abertas:** 8 (Migração, Núcleo financeiro, Planos/MP, WhatsApp, Mercado, PWA/Android, Segurança, Lançamento).
- **Tarefas críticas:** 7 · **Altas:** 14 · **Médias:** 18 · **Baixas:** 11.
- **Dependências externas:** 6 (Meta, Mercado Pago, Lovable AI, BrasilAPI, Joanin, Google Play/Jurídico).

| Frente | Prompts estimados |
|---|---|
| Migração de banco | 2–10 (2 se não existir migração; até 10 se existir) |
| Núcleo financeiro | 8–12 |
| Planos e Mercado Pago | 5–8 |
| WhatsApp | 6–10 (após aprovação Meta) |
| Mercado Inteligente | 10–15 |
| PWA / Android / biometria | 8–12 |
| Segurança e LGPD | 5–8 |
| Lançamento e monitoramento | 4–6 |
| **Total** | **≈ 48–81 prompts** |

Estimativa sujeita a: bloqueios técnicos, acesso aos ambientes, resultado dos testes, aprovação da Meta, disponibilidade de APIs externas e decisões comerciais.

---

## 24. CONCLUSÃO DA AUDITORIA

**Arquivo criado:** `docs/RELATORIO_COMPLETO_GASTO_INTELIGENTE_2026-07-31.md` (único arquivo criado).

**Confirmações:**
- Nenhum arquivo de código foi alterado.
- Nenhuma migration foi executada.
- Nenhum registro foi criado, alterado ou excluído (todas as consultas foram `SELECT`).
- Nenhuma mensagem de WhatsApp foi enviada.
- Nenhum pagamento foi realizado.
- Nenhum dispatcher ou cron foi ativado.
- Nenhum secret foi criado, alterado ou revelado.
- Nenhum valor de variável de ambiente foi exibido.

**Comandos executados (todos seguros e locais):** `bunx tsgo --noEmit`, `bunx eslint .`, `bun scripts/test-whatsapp.mjs`, buscas com `rg`/`ls`, e consultas `SELECT` read-only no banco.

### Dez achados mais importantes
1. Dados fictícios de R$ 666,6 bilhões em `receitas` corrompendo todo o financeiro agregado.
2. Pipeline atômico de billing do Mercado Pago nunca exercitado (`payment_events` = 0).
3. Templates Meta parados em `draft`, sem submissão — bloqueio total do outbound.
4. Vulnerabilidade crítica de supply chain (`seroval` via `@tanstack/*`).
5. Não há evidência de migração entre dois bancos; apenas um ambiente é acessível.
6. Quotas de WhatsApp zeradas inclusive para o plano pago `pessoal_manual`.
7. Empresa Inteligente e Investimentos publicados mas com zero registros reais.
8. Normalização de produtos sem produto canônico e com `merchant_brand_aliases` vazio.
9. PWA inexistente e biometria sem WebAuthn — "digital volta ao login" segue não resolvido.
10. Qualidade sólida onde importa: typecheck limpo, 2249/2249 testes verdes, RLS em 68/68 tabelas, zero grants para `anon`.

### Primeiro prompt de correção recomendado (não executado)
> **"Higienização controlada dos dados fictícios em produção: identifique e quarentene (sem excluir) os 12 registros de `receitas` com valor 5.555.555.555,00 e descrição '5555' criados em 2026-05-05, além dos gastos de teste com descrição 'Csa'. Apresente antes/depois das somas por usuário e por mês, proponha a estratégia (flag `is_test` vs. soft delete) e aguarde minha aprovação explícita antes de qualquer escrita."**
