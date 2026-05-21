# Auditoria de Tradução PT/EN — Plano em Fases

## Diagnóstico

Encontrei **131 arquivos** com texto em português hardcoded fora do sistema de i18n. Tentar traduzir todos de uma vez em uma resposta:

- Vai consumir muitos créditos (provavelmente várias respostas de 5-10 min cada).
- Risco alto de introduzir bugs (typos em chaves, strings quebradas, JSX inválido).
- Difícil revisar o que mudou.

Por isso vou dividir em **5 fases**, executando uma por turno. Você aprova esta fase 1, eu executo, valido o build, e seguimos.

## Categorização dos 131 arquivos

**Não precisa traduzir (~40 arquivos):** servidores (`src/server/*`), parsers (`whatsappParser`, `csv-fatura`), templates de e-mail, dados internos (constantes de plano, categorias seed). Os comentários e strings desses arquivos não aparecem para o usuário, ou são strings de banco/log.

**Prioridade ALTA — UI visível diariamente (~25 arquivos):**
- Mobile: `MobileTopBar`, `BottomNav`, `MobileShell`
- Dashboard: `SmartMonthSummaryCard`, `SmartLimiteCard`, `MonthForecastCard`, `DashboardAlertasBloco`, `DashboardCartoesInsights`, `RadarEconomicoCard`, `FluxoCaixaChart`
- Modais principais: `UpgradeModal`, `PremiumLockModal`, `InvestimentosLockModal`, `DeleteAccountDialog`, `CancelarAssinaturaDialog`
- Componentes: `PlanoCard`, `ConnectedAccountBanner`, `ConnectedAccountSwitcher`, `CompraInternacionalCard`, `AvisoWhatsAppBanner`, `BrandLoader`, `PageSkeleton`, `AuthGate`

**Prioridade MÉDIA — formulários e importação (~20 arquivos):**
- `GastoForm`, `EditGastoDialog`, `WhatsAppExpenseDialog`, `AvatarUpload`, `ClienteSelect`
- `ImportContaDialog`, `ImportExtratoDialog`, `ImportFaturaDialog`, `ImportInvestimentosFlow`, `ExtratosImportadosDialog`

**Prioridade BAIXA — rotas internas com poucos textos hardcoded (~30 arquivos):**
- Rotas que já usam `useTranslation` em ~90% do conteúdo mas têm fragmentos soltos.

**Hooks/libs com strings de UI (~15 arquivos):**
- `use-plan`, `use-roles`, `use-mes-referencia`, `use-alerts`, `subscription-guard`, `auth-context`, `active-account`, `recorrencias`, `mes-referencia`, `orcamento`, `relatorios`, `alertas-contas`, `category-visual`.

## Fases propostas

### Fase 1 (esta aprovação) — Mobile shell + Dashboard cards
Áreas que o usuário vê **toda vez que abre o app**. ~10 arquivos:
- `MobileTopBar.tsx`, `BottomNav.tsx` (revisar resíduos)
- `SmartMonthSummaryCard.tsx`, `SmartLimiteCard.tsx`, `MonthForecastCard.tsx`
- `DashboardAlertasBloco.tsx`, `DashboardCartoesInsights.tsx`
- `RadarEconomicoCard.tsx`, `FluxoCaixaChart.tsx`
- `CompraInternacionalCard.tsx`

Cria/atualiza chaves em `dashboard.json` e `common.json` (PT + EN).

### Fase 2 — Modais e bloqueios
`UpgradeModal`, `PremiumLockModal`, `InvestimentosLockModal`, `DeleteAccountDialog`, `CancelarAssinaturaDialog`, `PlanoCard`, `ConnectedAccountBanner/Switcher`, `AvisoWhatsAppBanner`, `BrandLoader`, `PageSkeleton`, `AuthGate`.

### Fase 3 — Formulários e diálogos de importação
`GastoForm`, `EditGastoDialog`, `WhatsAppExpenseDialog`, `AvatarUpload`, `ClienteSelect`, `Import*Dialog`, `ImportInvestimentosFlow`, `ExtratosImportadosDialog`.

### Fase 4 — Hooks/libs com strings de UI
`use-plan`, `use-roles`, `use-alerts`, `subscription-guard`, `recorrencias`, `mes-referencia`, `orcamento`, `relatorios`, `alertas-contas`, `category-visual`, `auth-context` (toasts).

### Fase 5 — Varredura final + rotas residuais
Re-rodar o scan, pegar o que restou (rotas com fragmentos), corrigir mixes (título PT + descrição EN). Entregar relatório final.

## Regras aplicadas em todas as fases

- Não altero layout, lógica de negócio, autenticação, planos ou dados.
- Não traduzo marca "Gasto Inteligente", nomes próprios, dados cadastrados, R$, nomes de bancos.
- Uso `useTranslation` que já existe; não crio nova arquitetura.
- Chaves novas mantêm padrão atual (namespaces por arquivo JSON).
- Tela `/app/idioma` permanece como está.
- Após cada fase, confirmo build limpo.

## O que preciso de você

Aprovar este plano para eu executar a **Fase 1** agora. Depois disso seguimos fase por fase em mensagens separadas — assim você controla o gasto e revisa cada parte antes da próxima.

Se preferir outro recorte (ex.: "comece pelas rotas X em vez do dashboard"), me diga.
