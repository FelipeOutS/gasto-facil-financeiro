# E2E — Plano `free_ads` (Fase 1E-B2G)

Esta suíte usa Playwright para validar no browser real os fluxos básicos
liberados ao plano `free_ads`. Ela foi projetada para **falhar com
segurança**: se as variáveis necessárias não estiverem definidas, os testes
são marcados como `skipped` com mensagem clara — nada é executado contra
produção e nenhum usuário real é alterado.

## Por que isso existe

Os testes unitários em `tests/free-ads-plan.test.ts` cobrem os gates puros
de plano. Os specs aqui cobrem o que só pode ser validado no browser:
login, navegação, gates de rota, formulários e bloqueio de premium.

## Variáveis de ambiente

| Variável | Obrigatória | Para quê |
| --- | --- | --- |
| `E2E_BASE_URL` | sim | URL do preview (ex.: `https://id-preview--<id>.lovable.app`) |
| `E2E_QA_EMAIL` | sim | E-mail de uma conta QA dedicada |
| `E2E_QA_PASSWORD` | sim | Senha da conta QA |
| `E2E_QA_USER_ID` | recomendada | UID da conta QA — usado para setup/rollback determinístico |
| `SUPABASE_URL` | opcional | Habilita setup/teardown automático |
| `SUPABASE_SERVICE_ROLE_KEY` | opcional | idem; **nunca** committar |

> **Service role só vive no shell que roda os testes.** Ela não entra no
> bundle, não vira `import.meta.env.*` e não é exposta ao browser.

Sem `E2E_BASE_URL` / `E2E_QA_EMAIL` / `E2E_QA_PASSWORD`, todos os specs
deste arquivo são `skipped`. Sem `SUPABASE_SERVICE_ROLE_KEY`, os specs
ainda rodam mas você deve colocar o usuário QA em `free_ads` manualmente
antes (e fazer rollback depois) — `setupFreeAdsForQAUser` devolve
`mode: "manual"` e apenas avisa no console.

## Como rodar localmente

```bash
# 1) Instalar o browser do Playwright (primeira vez)
bunx playwright install chromium

# 2) Exportar as variáveis (NÃO committar)
export E2E_BASE_URL="https://id-preview--5de62d63-2340-4175-8a16-26c2beff1e71.lovable.app"
export E2E_QA_EMAIL="qa+free-ads@example.com"
export E2E_QA_PASSWORD="..."
export E2E_QA_USER_ID="44f45eac-ae30-43cd-8e40-fa8ff6b0c0c4"
# Opcional, para setup/teardown automático:
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service role key>"

# 3) Rodar
bun run test:e2e:free-ads
```

Para os unitários (já existentes):

```bash
bun run test:unit
```

## Setup / Teardown

`tests/e2e/helpers/plan-setup.ts`:

- atualiza **apenas** a linha do UID/email QA;
- nunca faz `UPDATE` em massa;
- no `afterAll`, restaura para `plano='sem_assinatura'`/`status='sem_assinatura'`;
- após o rollback, executa `SELECT count(*) FROM user_plans WHERE plano='free_ads'`
  e falha gritante se for diferente de `0`.

## Limpeza de dados criados pelo QA

Os specs atuais criam **apenas leituras + navegação** e um possível registro
de teste em receita/gasto. Para limpar manualmente após uma rodada local:

```sql
DELETE FROM public.receitas WHERE user_id = '<QA_UID>' AND descricao ILIKE '%qa-e2e%';
DELETE FROM public.gastos   WHERE user_id = '<QA_UID>' AND descricao ILIKE '%qa-e2e%';
DELETE FROM public.mercado_listas WHERE user_id = '<QA_UID>' AND nome ILIKE '%qa-e2e%';
```

## O que esta fase NÃO faz

- Não cria `chooseFreePlan`.
- Não ativa o botão "Começar grátis".
- Não cria server fn pública de seed.
- Não toca em checkout, Mercado Pago, RLS, AdSlot ou anúncios.
- Não migra usuários reais.
- Não libera nenhuma feature nova.
