# MATRIZ DE FUNCIONALIDADES — GASTO INTELIGENTE

**Data:** 2026-08-05 · **Base:** 130 rotas em `src/routes`, 20 endpoints em `src/routes/api`, 95 módulos em `src/server`, 76 tabelas com RLS, 2330 testes verdes.

## Legenda de status

| Símbolo | Significado |
|---|---|
| ✅ **Implementado + coberto** | rota existe, lógica de servidor existe, coberto por teste automatizado e/ou verificado no banco |
| 🟢 **Implementado** | rota e lógica existem; sem teste dedicado identificado |
| ⏸️ **Implementado, desligado** | código pronto, desativado por flag/regra de negócio |
| 🔒 **Restrito** | disponível apenas a `owner`/admin ou plano específico |
| ⚠️ **Parcial** | funcionalidade com lacuna conhecida e documentada |
| ❔ **Não validado em produção** | não foi possível exercitar na jornada autenticada (ver §11 da auditoria) |

---

## 1. Público / aquisição

| Funcionalidade | Rota | Status | Evidência |
|---|---|---|---|
| Landing comercial | `/` (`index.tsx` → `PublicLanding.tsx`) | ✅ | 200 em produção, H1 correto, 0 erro de console |
| Preços de planos na landing | `PublicLanding.tsx:3378-3404` | ✅ | preços vindos de `COMMERCIAL_PLANS`, sem divergência |
| Cadastro | `/cadastro` | 🟢 ❔ | 200 em produção |
| Login | `/login` | ✅ | 200, H1 “Bem-vindo de volta”, 0 erro |
| Recuperar senha | `/recuperar-senha` | 🟢 | 200 |
| Reset de senha | `/reset-password` | 🟢 | rota pública dedicada existe |
| Confirmação de e-mail | `/confirmar` | 🟢 | rota pública |
| Termos / Privacidade / LGPD | `/termos`, `/privacidade`, `/lgpd` | ✅ | 200 cada |
| Status público | `/status` | ✅ | 200, no sitemap |
| SEO técnico | `sitemap[.]xml`, `robots.txt`, JSON-LD em `__root.tsx` | ⚠️ | sitemap/JSON-LD OK; `robots` permite rotas privadas (P2-01) |
| i18n PT/EN | `/pt/$`, `/en/$`, `src/i18n` | 🟢 | hreflang dinâmico em `__root.tsx:410-436` |
| Consentimento de cookies + GTM pós-consentimento | `CookieConsentProvider` | 🟢 | GTM não injetado antes do consentimento (`__root.tsx:74-76`) |
| PWA instalável + update toast | `public/manifest.webmanifest`, `public/sw.js`, `PWAUpdateToast.tsx` | ✅ | `tests/pwa.test.ts` 5 pass |

## 2. Núcleo financeiro pessoal

| Funcionalidade | Rota | Status | Evidência |
|---|---|---|---|
| Dashboard / resumo | `/resumo` | 🟢 ❔ | redireciona para `/login` sem sessão (correto); conteúdo não validado |
| Gastos (listar/criar/editar) | `/gastos`, `/gastos/$id/editar`, `/adicionar` | ✅ ❔ | 133 registros reais; RLS por `user_id`; coberto por testes de handler |
| Receitas / renda | `/renda`, `/renda/nova`, `/renda/$id/editar` | ✅ | 123 registros; `tests/receitas-soft-delete-e-teto-valor.test.ts` 15 pass |
| Cartões e faturas | `/cartoes*` | ✅ ❔ | 5 cartões; testes de faturas/parcelamento |
| Contas a pagar | `/contas-a-pagar*` | ✅ | 19 registros; `whatsapp-baixa-conta-atomic-3-30` 9 pass |
| Contas a receber | `/contas-a-receber*` | 🟢 | 2 registros |
| Assinaturas / recorrências | `/assinaturas*` | ✅ | `recorrencia-mensal-dias-29-30-31` 15 pass |
| Metas financeiras | `/metas*` | 🟢 ❔ | tabelas `metas_financeiras`, `movimentacoes_meta` com RLS |
| Dinheiro guardado | `/guardado` | 🟢 | tabela `dinheiro_guardado` |
| Orçamento e limites | `/orcamento`, tabela `limites` | 🟢 | quotas `free_ads` via triggers `tg_free_ads_quota_limites` |
| Relatórios | `/relatorios` | 🟢 ❔ | 🔒 avançados exigem `pessoal_premium` (`plans.ts:130`) |
| Alertas / radar | `/alertas`, `/radar` | 🟢 | `user_alerts`; `radar.functions.ts` |
| Categorias | `/categorias` | 🟢 | `categorias` + `aprendizado_categoria` |
| Transferências internas | tabela `transferencias_internas` | 🟢 | RLS ativa |
| Fila offline (gastos e receitas) | `src/lib/offline/*` | 🟢 | montada globalmente em `__root.tsx:394-408` |

## 3. Importações e OCR (🔒 plano pago)

| Funcionalidade | Endpoint | Status |
|---|---|---|
| Importar extrato | `api/import-extrato.ts` | ✅ 🔒 auth + `ensurePremiumFeatureAccess` + rate limit |
| Importar fatura (PDF/imagem) | `api/import-fatura-pdf.ts`, `api/import-fatura-imagem.ts` | ✅ 🔒 |
| Importar conta (PDF) | `api/import-conta.ts`, `api/import-conta-pdf.ts` | ✅ 🔒 |
| Importar investimentos | `api/import-investimentos.ts` | ✅ 🔒 |
| OCR de gasto | `api/ocr-gasto.ts` | ✅ 🔒 |
| OCR de encarte de mercado | `api/mercado-flyer-ocr.ts` | ✅ 🔒 |
| Import Joanin/Carrefour | `api/mercado-joanin-import.ts` | 🔒 **restrito a `owner`**, fora do caminho de lançamento |

## 4. Investimentos

| Funcionalidade | Rota | Status |
|---|---|---|
| Carteira, novo ativo, edição | `/investimentos*` | 🟢 ❔ 🔒 `pessoal_premium+` |
| Movimentações, rendimentos, atualização em lote | `/investimentos.movimentacao*`, `.rendimento*`, `.atualizar-lote` | 🟢 ❔ |
| Importações de investimentos | `/investimentos.importar`, `.importacoes` | 🟢 🔒 |

## 5. Mercado Inteligente

| Funcionalidade | Rota | Status |
|---|---|---|
| Listas, carrinho, cesta, histórico | `/mercado_.listas*`, `.carrinho`, `.cesta`, `.historico` | 🟢 ❔ |
| Preços do usuário / comunitários / histórico | `.precos`, `.preco-comunitario`, `.precos-historico` | 🟢 |
| Mercados salvos, orçamento, calculadoras | `.mercados`, `.meus-mercados`, `.orcamento`, `.calculadoras` | 🟢 |
| Importar cupom | `.importar-cupom` | 🔒 `pessoal_premium+` |
| Sincronização com backend | `useMercadoSync` (`__root.tsx:278`) | 🟢 |

## 6. MEI / Empresa (🔒)

| Funcionalidade | Rota | Status |
|---|---|---|
| Clientes + relatório | `/clientes`, `/clientes_.relatorio` | 🟢 🔒 `recursos_mei` |
| Fornecedores + relatório | `/fornecedores`, `/fornecedores_.relatorio` | 🟢 🔒 |
| Empresa / dados CNPJ | `/empresa`, `cnpj_cache` | 🟢 🔒 |
| Contador | `/contador` | 🟢 🔒 |

## 7. Conta, segurança e privacidade

| Funcionalidade | Rota | Status |
|---|---|---|
| Perfil / conta | `/perfil`, `/conta`, `/app_.perfil` | 🟢 ❔ |
| Segurança da conta / app lock | `/conta_.seguranca`, `AppLockProvider` | 🟢 |
| Cofre pessoal (PIN) | `/app_.cofre-pessoal`, `vault_*` | 🟢 🔒 14 entradas reais; PIN via RPC `vault_pin_*` |
| Contas conectadas (compartilhamento) | `/contas-conectadas` | ⚠️ modelo inconsistente (P2-03) + 7 testes RLS em `it.todo` (P3-03) |
| Aceitar convite | `/aceitar-convite/$token` | 🟢 |
| Onboarding | `/onboarding`, `user_onboarding` | 🟢 |
| Idioma | `/app_.idioma` | 🟢 |
| Biometria / bridges Android | `src/lib/biometric-login.ts`, `android-security.ts` | ⚠️ apenas bridges; **não há código nativo no workspace** |

## 8. Monetização

| Funcionalidade | Local | Status |
|---|---|---|
| Meu plano / upgrade | `/meu-plano` | ✅ ❔ redireciona para login sem sessão; CTAs de upsell confirmados no bundle de produção |
| Checkout (criar) | `api/checkout.create.ts` | ✅ preço só do catálogo do servidor + idempotência |
| Checkout (verificar) | `api/checkout.verify.ts` | ✅ status consultado na API da MP com token do servidor |
| Webhook Mercado Pago | `api/public.webhooks.mercadopago.ts` | ✅ HMAC antes de qualquer escrita + validação de valor/plano/moeda |
| Integração MP do usuário | `api/integrations.mercadopago.*` | ✅ auth/state assinado |
| Cancelamento / resolução de assinatura | `mercadopago-cancellation-resolver.server.ts` | ✅ coberto por testes |
| Plano `free_ads` | `plans.ts`, triggers `tg_free_ads_quota_*` | ✅ 21 usuários ativos |
| Upsell inteligente | `UpsellBanner/Modal/ContextualGate`, `upsell-eligibility.server.ts`, `use-upsell-gate.ts` | ✅ ❔ `upsell-9h-correcoes` 19 pass; jornada autenticada não exercitada em produção |
| Anúncios (free) | `ads-config.ts`, `ads-consent.ts`, `.env.production` | 🟢 `VITE_ENABLE_REAL_ADS=true`, provider `direct` |

## 9. WhatsApp (⏸️ desligado)

| Funcionalidade | Status |
|---|---|
| Webhook de entrada | ⏸️ código pronto, HMAC verificado, bloqueado por `global_enabled=false` |
| Lançamento por texto/áudio/foto | ⏸️ ✅ coberto por ~100 arquivos de teste |
| Pix, boletos (OCR), comprovantes | ⏸️ ✅ |
| Consultas (gastos, receitas, faturas, metas, orçamento) | ⏸️ ✅ |
| Notificações + dispatcher + quotas atômicas | ⏸️ ✅ `outbound_enabled=false` |
| Templates Meta | ⚠️ 3 templates `pt_BR` em `status=pending`, `active=false` |
| Entitlement | 🔒 planos pagos + allowlist beta + runtime config |
| Edição de recorrência escopo `SINGLE`/`FUTURE_PENDING` | ⚠️ **não implementado** (2 `it.skip`) |

## 10. Administração (🔒 `owner`)

| Funcionalidade | Rota | Status |
|---|---|---|
| Painel admin | `/admin` | 🔒 role `owner` via `assertAdminMaster` |
| Saúde do sistema | `/admin_.saude` | 🔒 |
| Runtime WhatsApp (flags/quotas) | `/admin_.whatsapp-runtime` | 🔒 |
| Auditoria | `audit_logs`, `webhook_logs`, `whatsapp_runtime_config_audit` | 🟢 |

## 11. Infraestrutura de e-mail

| Funcionalidade | Local | Status |
|---|---|---|
| Fila de e-mail + dispatch | `routes/lovable/email/queue/process.ts`, RPCs `email_queue_*`, `enqueue_email` | 🟢 |
| Log, estado, supressão, unsubscribe | `email_send_log`, `email_send_state`, `suppressed_emails`, `email_unsubscribe_tokens` | 🟢 RLS ativa |

---

## Resumo quantitativo

| Status | Contagem aproximada de itens |
|---|---|
| ✅ Implementado + coberto | 31 |
| 🟢 Implementado | 44 |
| ⏸️ Implementado, desligado | 7 (bloco WhatsApp) |
| ⚠️ Parcial / lacuna conhecida | 6 |
| ❔ Não validado na jornada autenticada em produção | 17 |
