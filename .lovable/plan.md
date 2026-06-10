# Fase P2/P3 — Auditoria de UX, Estabilidade e Produto

Plano organizado a partir da leitura das telas do Mercado Inteligente, Gastos/Cartões/Dashboard, componentes compartilhados (`PremiumLockModal`, `EmptyState`, `AppEmptyStateVisual`, `AppPageHeader`, `SectionBlock`, `MobileShell`, `sonner`) e da estrutura de i18n (PT/EN paralelos). Nada será alterado nesta etapa — esta é a fase de diagnóstico e priorização.

---

## A. Melhorias P2 recomendadas

| # | Rota/Tela | Problema | Impacto | Sugestão | Risco |
|---|---|---|---|---|---|
| A1 | `/mercado` (home) | Seções (`SectionBlock`) sem estado vazio dedicado quando o usuário nunca usou listas/carrinho/histórico — aparecem blocos quase em branco. | Sensação de app vazio no primeiro uso. | Usar `AppEmptyStateVisual` por seção com CTA claro ("Criar lista", "Adicionar ao carrinho"). | Baixo (apenas UI). |
| A2 | `/mercado/carrinho` | Finalização: lock anti-duplo clique já existe, mas o feedback de "criando gasto" é um toast curto; sem confirmação visual do gasto gerado. | Usuário não percebe vínculo Carrinho → Gasto. | Após `addGastoAuto`, mostrar toast com ação "Ver em /gastos" + badge "origem: Mercado" no item. | Baixo (UI/toast). |
| A3 | `/mercado/historico` | Excluir histórico não explica que gasto/cartão/preço comunitário permanecem. | Usuário teme perder dados financeiros. | Dialog de confirmação com bullets do que é e do que não é apagado. | Baixo. |
| A4 | `/mercado/preco-comunitario` | Sem indicação visual de quais preços são próprios vs comunidade; sem filtro por mercado/distância. | Confusão sobre origem do preço. | Badge "Seu preço"/"Comunidade" + filtros básicos. | Médio (lê dados; sem alterar RLS). |
| A5 | `/mercado/importar-cupom` (NFC-e) | Erros de OCR/parse aparecem genéricos ("Falha ao processar"). | Usuário não sabe se foi rede, QR inválido ou rate limit. | Mapear via `getFriendlyErrorKey` + tratar 429 com mensagem específica. Não alterar parser/rate limit. | Baixo. |
| A6 | `/mercado/listas` e `/mercado/listas/$id` | Ações principais (adicionar item, mover para carrinho) competem visualmente; sem progresso "X de Y comprados". | Baixa orientação. | Header com progresso + CTA primário único por contexto. | Baixo. |
| A7 | `/gastos` | Gastos vindos do Mercado não mostram origem distinguível. | Auditoria difícil. | Tag/ícone "Mercado" no item + filtro "origem". (Sem alterar `addGastoAuto`.) | Baixo (UI; campo já gravado). |
| A8 | `/cartoes/$id` | Fatura: itens crédito-Mercado sem link de volta ao histórico da compra. | Rastreabilidade. | Link leve "Ver compra" quando houver `origemMercadoId`. | Baixo. |
| A9 | `/meu-plano` e `PremiumLockModal` consumidores | Algumas telas premium mostram bloqueio sem preview do recurso. | Conversão fraca. | Tela bloqueada com preview borrado + CTA único. (Sem alterar `PremiumLockModal` em si.) | Baixo. |
| A10 | Toasts globais | Mix de `toast.success/error` com tons e durações inconsistentes. | Ruído visual. | Padronizar via wrapper (`notify.success/error/info`) sem trocar `sonner`. | Baixo. |
| A11 | Mobile — headers do Mercado | Vários headers usam `flex flex-wrap`, podem clipar em 360px. | Layout quebra. | Aplicar padrão `grid-cols-[minmax(0,1fr)_auto]` + `min-w-0`/`truncate`. | Baixo. |
| A12 | Dashboard | Cards repetem KPIs do mês corrente sem hierarquia clara. | Densidade confusa. | Agrupar em "Hoje / Mês / Tendências" com 1 card destaque. | Médio (somente layout). |

---

## B. Melhorias P3 recomendadas (polimento)

- B1. Skeletons dedicados por seção do Mercado (hoje cai em `BrandLoader` cheio).
- B2. Microinterações: `animate-rise`/`animate-pop` já existem em `EmptyState` — estender a cards de lista/carrinho.
- B3. Estados vazios ilustrados (usar `AppEmptyStateVisual` com tom por módulo) em `/mercado/precos`, `/precos-historico`, `/meus-mercados`, `/orcamento`, `/calculadoras`, `/cesta`.
- B4. Revisão de textos: encurtar títulos longos em `meu-plano.json`, `gastos.json`, `cartoes.json`.
- B5. Padronizar copy de confirmação ("Tem certeza?" → frases ativas: "Excluir esta lista?").
- B6. Espaçamento: padronizar `mt-6` do `SectionBlock` com tokens; revisar `gap` em cards densos.
- B7. Hierarquia: usar `AppPageHeader` com `tone` consistente por módulo (mercado=accent, gastos=danger leve, cartões=info).
- B8. Acessibilidade: `aria-live` em toasts críticos do Mercado, foco visível em CTAs primários.
- B9. Dark mode: revisar contraste de badges "Comunidade"/"Seu preço".
- B10. Favicon/OG por rota leaf (`/mercado/*`) — hoje cai no root.

---

## C. Quick wins seguros (baixo risco, alto retorno)

1. Padronizar mensagens de erro com `getFriendlyErrorKey` nas telas `/mercado/*` que ainda usam string crua.
2. Adicionar `truncate` + `min-w-0` nos headers mobile do Mercado (A11).
3. Tag "Mercado" no item de `/gastos` (A7) — campo já existe.
4. Toast pós-finalização do carrinho com ação "Ver gasto" (A2).
5. Dialog informativo no excluir histórico (A3).
6. Empty states ilustrados nas 6 telas do Mercado sem estado vazio (B3).
7. Wrapper `notify.*` para uniformizar toasts (A10).
8. Skeleton por seção em `/mercado` (B1).

Cada um é isolado, sem tocar lógica de negócio, RLS, planos ou pagamentos.

---

## D. Itens que NÃO devem ser mexidos (hotfix P0/P1 congelado)

Confirmado — permanecem intocados nesta fase:

- Auth, RLS, planos, `FeatureKeys`, `PremiumLockModal` (consumo OK; componente não).
- Mercado Pago (incl. webhook), checkout, migrations.
- WhatsApp (endpoint público + flags).
- OCR, Joanin, Google Maps, parser NFC-e.
- Rate limit nos 9 endpoints caros.
- `addGastoAuto` e fluxo Mercado → Histórico → Preço Comunitário → Gastos → Cartões.
- Isolamento de `localStorage` por `activeUserId`.
- `src/integrations/supabase/*` (auto-gen).

Qualquer melhoria P2/P3 que esbarre nesses pontos será **parada e reportada**, não implementada silenciosamente.

---

## E. Ordem sugerida de implementação (lotes pequenos)

**Lote 1 — UX Mercado (base)**
A1, A3, A6, B3, B1. Foco: empty states, confirmações, skeletons.

**Lote 2 — Textos e i18n**
B4, B5 + Quick win #1 (`getFriendlyErrorKey` em `/mercado/*`). Auditoria PT/EN, sem novas chaves hardcoded.

**Lote 3 — Dashboard / Gastos / Cartões**
A7, A8, A12. Tag de origem, link fatura→compra, hierarquia do dashboard.

**Lote 4 — Performance leve e acabamento**
A10 (toasts), A11 (mobile headers), B2, B6, B7, B8, B9, B10.

**Lote 5 — Premium preview**
A9: preview borrado + CTA único nas telas bloqueadas (sem alterar `PremiumLockModal`).

**Lote 6 (futuro, fora desta fase) — ver seção abaixo.**

---

## Fase futura — Plano Free com Ads

Documentado, **não implementar agora**:

- Definir oficialmente o plano free (hoje "free" = sem assinatura/legado/teste técnico).
- Quais recursos liberar (provável: Mercado básico, gastos limitados, sem OCR/IA).
- Limites de uso por dia/mês nos endpoints caros (reaproveitar `enforceUserRateLimit`).
- Onde anúncios aparecem (nunca em telas financeiras sensíveis: gastos, cartões, fatura, preço comunitário com dados próprios).
- Conformidade LGPD: consentimento, opt-out, sem PII para redes de ads.
- Ajuste em `meu-plano`, `PremiumLockModal`, upgrade flow.
- Impacto em OCR/IA/importações (mantê-los pagos ou com cota muito baixa).
- Fase isolada de produto + monetização + permissões; não misturar com UX P2/P3.

---

## Próximo passo

Confirmar quais lotes (1 a 5) inicio e em que ordem. Sugiro começar pelo **Lote 1** por ser o de maior ganho percebido e menor risco. Nada será alterado até a sua aprovação.