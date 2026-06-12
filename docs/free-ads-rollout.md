# Free Ads Rollout — Operational Checklist

**Fase 1E-B2N.** Documento operacional para liberar/desligar o plano
`free_ads` em produção. **Não altera lógica de produto.** Apenas descreve
flags, checklists, queries e plano de rollback.

---

## 1. Flags de build

Ambas são `VITE_*` → resolvidas em **build-time**. Alterar exige
**rebuild + redeploy**. Não existe toggle em runtime.

### `VITE_ENABLE_FREE_ADS_SIGNUP`

- Controla o CTA **"Começar grátis"** em `/meu-plano`.
- **Default seguro: `false`.**
- `false` → card visível como informativo, botão renderizado como
  **"Em breve" / "Coming soon"**, desabilitado, com tooltip.
  `handleChooseFreeAds` faz short-circuit antes de chamar a server fn.
- `true` → usuários elegíveis (`sem_assinatura`, `free` legado,
  `expirado`, `cancelado`) podem ativar `free_ads`.
- Usuários **Admin Master** e **plano pago ativo** **nunca** veem o CTA,
  independente da flag.
- Usuários já em `free_ads/ativo` continuam vendo "Plano atual".

### `VITE_ENABLE_AD_PLACEHOLDERS`

- Controla o componente visual `AdSlot`.
- **Default: ligado** (só desliga se valor for explicitamente `"false"`).
- Renderiza **apenas** para `plan === "free_ads"` + `status === "ativo"`,
  e nunca para Admin Master.
- **Zero requests externos**, sem script, iframe, pixel, cookie ou tracking.
  Apenas card estático interno.
- Kill-switch global: defina `"false"` para esconder em todos os usuários
  sem alterar código.

---

## 2. Checklist de deploy inicial (signup OFF)

Configuração recomendada para a primeira ida a produção:

- [ ] `VITE_ENABLE_FREE_ADS_SIGNUP=false`
- [ ] `VITE_ENABLE_AD_PLACEHOLDERS=true` (ou registrar decisão contrária)
- [ ] `bun run test:unit` verde
- [ ] `bunx tsc --noEmit` sem erros
- [ ] Build/harness limpo
- [ ] `SELECT COUNT(*) FROM user_plans WHERE plano='free_ads'` = `0`
- [ ] QA visual: usuário sem assinatura em `/meu-plano` vê card
      "Gratuito com anúncios" com botão **"Em breve"** desabilitado
- [ ] QA visual: usuário em plano pago ativo **não** vê CTA de downgrade
- [ ] QA visual: Admin Master **não** vê CTA
- [ ] Checkout Mercado Pago: fluxo normal continua funcionando
- [ ] Webhooks Mercado Pago: continuam respondendo

---

## 3. Checklist de liberação pública (signup ON)

Quando o produto estiver pronto para liberar oficialmente:

1. Setar `VITE_ENABLE_FREE_ADS_SIGNUP=true` no ambiente de produção.
2. Rebuild + redeploy.
3. Criar/usar conta nova sem assinatura.
4. Em `/meu-plano`, clicar **"Começar grátis"**.
5. Confirmar no banco:
   ```sql
   SELECT plano, status, current_period_start
   FROM user_plans WHERE user_id = '<UID>';
   -- esperado: free_ads / ativo / timestamp recente
   ```
6. Confirmar audit log:
   ```sql
   SELECT created_at, action, metadata
   FROM audit_logs
   WHERE user_id = '<UID>' AND action = 'choose_free_ads_plan'
   ORDER BY created_at DESC LIMIT 5;
   ```
7. Smoke-test dos recursos básicos liberados: gastos manuais, receitas
   manuais, mercado básico, metas, orçamento, 1 cartão.
8. Smoke-test dos bloqueios premium: faturas, importação de fatura,
   parcelamento, OCR/IA, investimentos, relatórios avançados,
   assinaturas, WhatsApp, cofre — todos continuam bloqueados.
9. Monitorar os primeiros usuários (queries da seção 4) durante as
   primeiras 24–72h.

---

## 4. Queries de monitoramento

Não há dashboard dedicado; rodar manualmente conforme necessidade.

```sql
-- 4.1 Total de usuários ativos em free_ads
SELECT COUNT(*) AS total_free_ads
FROM user_plans
WHERE plano = 'free_ads' AND status = 'ativo';

-- 4.2 Ativações por dia
SELECT DATE(current_period_start) AS dia, COUNT(*) AS ativacoes
FROM user_plans
WHERE plano = 'free_ads'
GROUP BY 1 ORDER BY 1 DESC LIMIT 30;

-- 4.3 Audit log de chooseFreeAdsPlan
SELECT DATE(created_at) AS dia, COUNT(*) AS chamadas
FROM audit_logs
WHERE action = 'choose_free_ads_plan'
GROUP BY 1 ORDER BY 1 DESC LIMIT 30;

-- 4.4 Usuários que atingiram quota (procurar nos logs de aplicação por
--      'free_ads_quota_exceeded'); inspecionar via tooling de logs.

-- 4.5 Garantia: nenhum plano pago caiu para free_ads
SELECT COUNT(*) AS pagos_ativos
FROM user_plans
WHERE plano NOT IN ('free_ads','sem_assinatura','free')
  AND status = 'ativo';
```

---

## 5. Plano de rollback operacional

**Rollback de novos cadastros (preferido, não-destrutivo):**

1. Setar `VITE_ENABLE_FREE_ADS_SIGNUP=false`.
2. Rebuild + redeploy.
3. Resultado: o CTA volta a "Em breve"; **nenhuma nova ativação** ocorre.
   Usuários já em `free_ads/ativo` **permanecem ativos** — não há
   downgrade automático nem perda de dados.

**Rollback de usuário específico (excepcional):**

Sempre por UID ou email exato. **Nunca** rodar update em massa sem filtro.

```sql
-- Exemplo: devolver UM usuário para sem_assinatura
UPDATE user_plans
SET plano = 'sem_assinatura',
    status = 'sem_assinatura',
    current_period_start = NULL,
    current_period_end = NULL,
    updated_at = NOW()
WHERE user_id = '<UID-EXATO>'
  AND plano = 'free_ads';
```

**Não fazer:**
- `UPDATE user_plans SET plano='sem_assinatura' WHERE plano='free_ads'`
  sem filtro de UID/email.
- Tocar em `checkout`, Mercado Pago, webhooks, RLS, `has_feature_access`,
  triggers de quota ou `AdSlot` funcional para rollback de produto.

---

## 6. Escopo intocado

Esta fase **não altera**:

- `chooseFreeAdsPlan` (server fn)
- Checkout, Mercado Pago, webhooks
- RLS, `has_feature_access`, policies
- Triggers de quota (`tg_free_ads_quota_*`)
- `AdSlot` funcional (apenas documentação)
- `premium-routes`, gates de features pagas
- Reset de senha, `addGastoAuto`, recorrências

---

## 7. Validações finais

```bash
bun run test:unit
bunx tsc --noEmit
# + build/harness
```

Esperado: tudo verde, zero erros.
