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

- Flag legada da fase de placeholder, substituída na Fase 1E-B2Q por
  `VITE_ENABLE_REAL_ADS` e `VITE_ADS_PROVIDER`.
- O fallback seguro atual é sempre o placeholder interno quando anúncios reais
  estão desligados; esta flag antiga não controla mais o renderer híbrido.

---

## 2. Checklist de deploy inicial (signup OFF)

Configuração recomendada para a primeira ida a produção:

- [ ] `VITE_ENABLE_FREE_ADS_SIGNUP=false`
- [ ] `VITE_ENABLE_REAL_ADS=false`
- [ ] `VITE_ADS_PROVIDER=placeholder`
- [ ] `bun run test:unit` verde
- [ ] `bunx tsc --noEmit` sem erros
- [ ] Build/harness limpo
- [ ] `SELECT COUNT(*) FROM user_plans WHERE plano='free_ads'` = `1` (conta QA fixa)
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

---

## 8. Conta QA fixa do plano Gratuito com anúncios

Este usuário é mantido permanentemente (ou a longo prazo) em `free_ads / ativo`
para testes manuais contínuos. **Não é um usuário real de produção.**

| Campo | Valor |
|-------|-------|
| E-mail | `felipeaitek@gmail.com` |
| UID | `44f45eac-ae30-43cd-8e40-fa8ff6b0c0c4` |
| Plano esperado | `free_ads` |
| Status esperado | `ativo` |

### Verificação rápida

```sql
SELECT COUNT(*) FROM user_plans WHERE plano = 'free_ads';
```

**Resultado esperado:** `1`

Esse `1` deve corresponder **exclusivamente** ao UID
`44f45eac-ae30-43cd-8e40-fa8ff6b0c0c4`.

### Regras operacionais

- **Não fazer rollback automático** desse usuário para `sem_assinatura`.
- **Não alterar** esse usuário, salvo pedido explícito do responsável.
- **Não promover** outros usuários para `free_ads` sem autorização.
- Se o total de `free_ads` for **maior que 1** sem autorização, investigar
  imediatamente.
- Se o usuário QA deixar de estar em `free_ads / ativo` sem solicitação,
  investigar imediatamente.
- Checkout, Mercado Pago, webhooks, RLS e código do produto continuam
  **intocados** por essa exceção.

---

## 9. Arquitetura híbrida de anúncios — Fase 1E-B2Q

O `AdSlot` continua sendo o wrapper público usado pelas páginas. Ele só encaminha
para o renderer quando o usuário está em `free_ads / ativo`, o plano terminou de
carregar e a conta não é Admin Master.

### Flags de build

```env
VITE_ENABLE_REAL_ADS=false
VITE_ADS_PROVIDER=placeholder
VITE_GOOGLE_ADSENSE_CLIENT=
VITE_ADSENSE_TEST_MODE=true
VITE_ADS_REQUIRE_CONSENT=true
```

Todas as flags `VITE_*` são resolvidas no build. Qualquer alteração exige
**rebuild + redeploy**. Providers válidos: `placeholder`, `direct` e `adsense`;
qualquer valor inválido volta para `placeholder` sem quebrar a página.

- `VITE_ENABLE_REAL_ADS=false`: sempre usa o placeholder interno.
- `placeholder`: card estático, sem chamadas externas.
- `direct`: usa configuração local. Nesta fase, somente `dashboard-middle` está
  configurado; `gastos-bottom`, `renda-bottom` e `mercado-bottom` permanecem como
  placeholder.
- `adsense`: só pode avançar com anúncios reais ligados, client ID preenchido e
  consentimento permitido quando obrigatório. Sem qualquer requisito, usa o
  placeholder.

### Modo direto

O anúncio direto não usa banco, imagem remota, script, iframe, pixel, cookie ou
tracking individual. O link abre em nova aba com `noopener noreferrer sponsored`
e UTM genérica, sem UID, e-mail ou dados financeiros. O conteúdo é identificado
explicitamente como Publicidade/Sponsored e não representa recomendação financeira.

### AdSense preparado, mas inativo

Não há Auto Ads. O loader controlado adiciona o script no máximo uma vez e somente
quando todos os gates forem satisfeitos. Os IDs de unidades estão intencionalmente
vazios, o client ID real não foi configurado e o helper de consentimento retorna
`false` por padrão. Portanto, **nenhum script AdSense é carregado na configuração
atual**, mesmo que o provider seja selecionado sem completar as pendências.

Antes de ativar AdSense real, são obrigatórios:

1. conta/site aprovados pelo Google AdSense;
2. client ID e IDs de unidades reais;
3. Política de Privacidade revisada;
4. Termos de Uso revisados;
5. CMP/consentimento e política de cookies implementados;
6. validação final das políticas do Google e QA sem clicar em anúncios reais.

### QA e expectativa operacional

A conta QA fixa `felipeaitek@gmail.com`
(`44f45eac-ae30-43cd-8e40-fa8ff6b0c0c4`) deve permanecer em `free_ads / ativo`.
O total esperado de registros com `plano = 'free_ads'` continua sendo **1**, e deve
corresponder exclusivamente a essa conta. Checkout, Mercado Pago, webhooks, RLS,
quotas, triggers, planos pagos e `chooseFreeAdsPlan` permanecem fora deste rollout.

---

## 10. Piloto direct/manual no Dashboard — Fase 1E-B2R

O piloto utiliza exclusivamente a campanha local `DIRECT_ADS["dashboard-middle"]`
em `src/lib/ads-config.ts`. Enquanto não houver parceiro aprovado, a URL deve
permanecer genérica/de exemplo. Para testar o modo direct:

```env
VITE_ENABLE_REAL_ADS=true
VITE_ADS_PROVIDER=direct
```

Para retornar ao fallback seguro:

```env
VITE_ENABLE_REAL_ADS=false
VITE_ADS_PROVIDER=placeholder
```

As flags são resolvidas no build; qualquer troca exige **rebuild + redeploy**.
Somente `dashboard-middle` possui campanha habilitada. Em modo direct,
`gastos-bottom`, `renda-bottom` e `mercado-bottom` não encontram campanha local e
continuam renderizando o placeholder. Nenhum anúncio foi inserido em formulários,
modais, autenticação, checkout, pagamento ou ações financeiras críticas.

### Troca segura do parceiro

Antes de substituir `https://exemplo.com`, revisar:

- [ ] domínio e destino aprovados pelo responsável do produto;
- [ ] HTTPS e página de destino funcionando em mobile e desktop;
- [ ] UTM somente com valores genéricos (`utm_source`, `utm_medium`,
      `utm_campaign`), sem UID, e-mail, nome ou dados financeiros;
- [ ] texto identificado como Publicidade/Sponsored, sem recomendação financeira
      personalizada;
- [ ] link abre em nova aba e preserva
      `rel="noopener noreferrer sponsored"`;
- [ ] nenhuma chamada de analytics, registro de impressão/clique, cookie, pixel,
      iframe, imagem remota ou JavaScript externo;
- [ ] QA visual com `free_ads / ativo` e testes negativos para plano pago,
      Admin Master, `sem_assinatura`, expirado, cancelado e loading.

O conteúdo do anúncio fica em `src/i18n/locales/pt/common.json` e
`src/i18n/locales/en/common.json`. O modo direct é um link HTML estático: não usa
banco nem envia eventos. O gate continua centralizado no `AdSlot`, que só encaminha
o renderer após o plano carregar e apenas para usuário não-admin com
`plan = free_ads` e `status = ativo`.

### AdSense e conta QA

AdSense continua **inativo**: sem Client ID real, sem unidades configuradas, sem
Auto Ads e com consentimento publicitário negado por padrão. Ativar o provider
direct não carrega o script do Google nem qualquer outro script externo.

A conta QA fixa `felipeaitek@gmail.com`
(`44f45eac-ae30-43cd-8e40-fa8ff6b0c0c4`) deve permanecer em
`free_ads / ativo`, sem rollback. Durante o piloto, o resultado esperado de
`SELECT COUNT(*) FROM user_plans WHERE plano = 'free_ads'` permanece **1**,
correspondente exclusivamente a essa conta.
