# PLANO DE AÇÃO PÓS-AUDITORIA — GASTO INTELIGENTE

**Data:** 2026-08-05 · **Base:** `docs/AUDITORIA_COMPLETA_SITE_GASTO_INTELIGENTE_2026-08-05.md`
**Premissa:** nada aqui foi executado. Este documento é proposta priorizada, aguardando autorização item a item.

---

## Regra de priorização

| Prioridade | Critério | Janela sugerida |
|---|---|---|
| **P0** | bloqueia venda ou expõe dado | *nenhum item P0 identificado* |
| **P1** | não bloqueia venda, mas aumenta risco ou reduz conversão | antes de escalar tráfego pago |
| **P2** | inconsistência de modelo, SEO ou manutenção | próxima janela planejada |
| **P3** | higiene técnica | contínuo |

---

## FASE 1 — P1 (segurança de borda e performance)

### A1-01 — Cabeçalhos de segurança HTTP (CSP, frame-ancestors, Permissions-Policy)
- **Problema:** produção não envia `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors` nem `Permissions-Policy`; nenhuma definição no código.
- **Ação:** definir cabeçalhos na camada de resposta do app (middleware de request do TanStack Start ou configuração de hosting), começando em **`Content-Security-Policy-Report-Only`** para medir quebras antes de aplicar em modo enforce.
- **Cuidado obrigatório:** o GTM e as fontes do Google são carregados em runtime; a CSP precisa contemplar `https://www.googletagmanager.com`, `https://fonts.googleapis.com`, `https://fonts.gstatic.com` e o domínio do backend, senão a landing e o consentimento quebram.
- **Validação:** `curl -sI` mostrando os cabeçalhos + smoke Playwright em `/`, `/login`, `/cadastro` com 0 erro de console.
- **Esforço:** baixo. **Risco de regressão:** médio (por isso report-only primeiro).

### A1-02 — Redução do chunk inicial (1,92 MB em `main-*.js`)
- **Problema:** bundle inicial pesado para o público mobile 4G.
- **Ação:** analisar o conteúdo do chunk `main`, mover bibliotecas grandes de rota específica para `lazy`/dynamic import e checar se `PieChart`/gráficos entram no caminho crítico da landing.
- **Validação:** comparação de tamanho antes/depois + build verde + smoke das rotas públicas.
- **Esforço:** médio. **Risco:** médio (splitting pode expor imports server-only; exige checar `*.server`/`client.server`).

---

## FASE 2 — P2 (SEO, superfície e coerência de modelo)

### A2-01 — Não indexar áreas autenticadas
- **Ação:** adicionar `Disallow` explícito em `public/robots.txt` para as áreas privadas (`/resumo`, `/gastos`, `/cartoes`, `/contas-a-pagar`, `/contas-a-receber`, `/investimentos`, `/mercado`, `/metas`, `/renda`, `/meu-plano`, `/admin`, `/perfil`, `/conta`, `/guardado`, `/relatorios`, `/orcamento`, `/alertas`, `/radar`, `/gasto-ai`) e `meta robots noindex` no `head()` dessas rotas.
- **Cuidado:** não incluir `/`, `/login`, `/cadastro`, `/termos`, `/privacidade`, `/lgpd`, `/status` — são páginas de aquisição.
- **Validação:** `curl` do `robots.txt` + inspeção do `head` renderizado.
- **Esforço:** baixo. **Risco:** baixo.

### A2-02 — Varredura de `EXECUTE` em funções `SECURITY DEFINER`
- **Ação:** listar todas as funções `SECURITY DEFINER` do schema `public` com `EXECUTE` para `anon`, classificar quais precisam ser públicas (ex.: fluxo de convite por token) e **revogar o resto** em migration única.
- **Cuidado:** `fetch_invite_by_token` e afins podem depender legitimamente de acesso anônimo; revogar às cegas quebra o aceite de convite. Classificar antes de revogar.
- **Validação:** re-executar o security scan (esperado: finding 0028 reduzido) + suíte integral verde.
- **Esforço:** médio. **Risco:** médio-alto se feito sem classificação.

### A2-03 — Decidir o modelo de acesso “view” em contas compartilhadas
- **Problema:** `contas_a_pagar` usa `can_admin_account()` enquanto `gastos`/`receitas`/`bancos` usam `can_view_account()`. Hoje um convidado “view” vê gastos mas não vê contas a pagar da mesma conta.
- **Ação:** **decisão de produto primeiro** (o convidado “view” deve ver contas a pagar?). Só então alinhar a policy — em qualquer direção.
- **Cuidado:** afrouxar a policy amplia visibilidade de dado financeiro; não fazer isso sem decisão explícita registrada.
- **Esforço:** baixo (após decisão). **Risco:** alto se decidido implicitamente.

### A2-04 — Unificar `getUserFromRequest` nas rotas de checkout
- **Ação:** `checkout.create.ts` e `checkout.verify.ts` passam a importar o helper de `src/server/api-auth.ts`, eliminando as duas cópias.
- **Validação:** testes de segurança de checkout existentes (`mercadopago-checkout-session-security`, `mercadopago-integration-scenarios`) verdes.
- **Esforço:** baixo. **Risco:** baixo, mas é código de cobrança — exige suíte integral.

---

## FASE 3 — P3 (higiene e lacunas conhecidas)

### A3-01 — Policy de DELETE em `user_communication_preferences`
Adicionar `DELETE` com `auth.uid() = user_id` **se** a exclusão pelo usuário for funcionalidade desejada (hoje a tabela está vazia; pode-se optar por manter fail-closed).

### A3-02 — Fechar as 7 lacunas de teste RLS de contas conectadas
Provisionar credenciais/JWT de QA para converter os `it.todo` de `tests/connected-accounts-viewer-policy-sec-ca-01b.test.ts` em asserções reais. É a maior lacuna de **cobertura** de segurança do projeto.

### A3-03 — Implementar escopos `SINGLE` e `FUTURE_PENDING` na edição de recorrência via WhatsApp
Dois `it.skip` em `tests/whatsapp-contas-editar.test.ts` representam funcionalidade ausente, não teste frágil. Deve entrar no escopo antes de qualquer liberação do canal.

### A3-04 — Sincronizar textos de benefícios de plano (i18n ↔ `plans.ts`)
Auditar as chaves `plans.highlights.*` e `plans.names.*` nos locales contra `PLAN_CATALOG`. Preço não pode divergir; texto pode.

### A3-05 — Débito de lint editável (~119 erros)
Seguir `docs/PLANO_CORRECAO_LINT_LEGADO_2026-08-05.md`, priorizando `src/routes/api/import-extrato.ts` (19), `src/lib/admin.functions.ts` (12), `src/lib/recorrencias.ts` (10). **Não** tentar “corrigir” os 4215 erros de Prettier em `src/integrations/supabase/types.ts` — arquivo autogerado; deve ser ignorado pelo linter, não reformatado.

---

## FASE 4 — Fechar os limites de validação (não é código, é evidência)

### A4-01 — Sessão de teste em produção
**Item de maior valor deste plano.** Hoje não é possível validar em produção nenhuma jornada autenticada (`LOVABLE_BROWSER_AUTH_STATUS=signed_out`). Enquanto isso persistir, toda afirmação sobre dashboard, lançamentos, upsell e cofre em produção depende exclusivamente de testes determinísticos.
**Ação:** criar conta de QA dedicada em produção (plano `free_ads` e outra em plano pago) e executar smoke autenticado documentado.

### A4-02 — Smoke de cobrança em sandbox
Executar um checkout ponta-a-ponta em ambiente sandbox, incluindo webhook, para comprovar a ativação de plano por transação real — hoje comprovada apenas por leitura de código e schema.

### A4-03 — Medição de Core Web Vitals de campo
Instrumentar/observar LCP, INP e CLS reais na landing antes e depois de A1-02.

---

## Sequência recomendada

```
A1-01 (CSP report-only) → A2-01 (robots/noindex) → A4-01 (conta QA)
   → A1-02 (bundle) → A2-04 → A2-02 (com classificação) → A2-03 (após decisão de produto)
   → A3-* (contínuo) → A4-02 / A4-03
```

## Portões obrigatórios para qualquer item acima

1. `bunx tsc --noEmit` → 0 erros
2. `bun scripts/run-test-suite.ts` → 0 fail, 0 errors (baseline atual: 135 arquivos, 2330 pass, 9 skip)
3. `bun run build` → exit 0
4. Lint dos arquivos alterados → 0 erros
5. Security scan → sem novo finding de nível superior a `warn`
6. Smoke em produção das rotas públicas → 0 erro de console

**Nada é publicado com FAIL > 0.**
