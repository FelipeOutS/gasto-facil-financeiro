
# Reformulação UX/UI — Mercado Inteligente

Objetivo: transformar o módulo em uma experiência com cara de app de supermercado moderno (mobile-first, visual, comercial), preservando 100% da lógica, integrações, planos, gates, OCR, importações, Mercado Pago, WhatsApp e Maps.

---

## 1. Auditoria do módulo atual

Telas hoje (em `src/routes/`):

- `mercado.tsx` — hub com 11 cards genéricos em grid (ícone + título + status). Funcional, mas tem cara de "menu de configurações", não de app de supermercado.
- `mercado_.listas.tsx` / `mercado_.listas_.$id.tsx` / `mercado_.listas_.nova.tsx` — listas de compras.
- `mercado_.carrinho.tsx` — carrinho ativo.
- `mercado_.orcamento.tsx` — orçamento mensal de mercado.
- `mercado_.historico.tsx` — histórico de compras (premium).
- `mercado_.calculadoras.tsx` — preço por kg/L, comparador.
- `mercado_.mercados.tsx` — mercados próximos (Google Maps).
- `mercado_.meus-mercados.tsx` — mercados favoritos.
- `mercado_.precos.tsx` / `mercado_.precos-historico.tsx` — preços (premium).
- `mercado_.cesta.tsx` — cesta básica de referência.
- `mercado_.importar-cupom.tsx` — OCR de cupom fiscal.
- `mercado_.preco-comunitario.tsx` — preço comunitário + importador Joanin Online.

Diagnóstico:
- Hub atual = grid de 11 cards equivalentes. Sem hierarquia, sem vitrine, sem produtos. Não comunica "supermercado".
- Não existe busca global de produto/preço.
- Não existe "mercado atual" persistido visível em todas as telas do módulo.
- Sem banners, sem ilustrações contextuais, sem categorias visuais.
- Telas internas são sólidas funcionalmente mas visualmente isoladas — cada uma com seu padrão.
- Não há tela única de "Produto" — o produto vive disperso (carrinho, lista, preço comunitário) e não como protagonista.

O que NÃO será tocado:
- Schemas Supabase, RLS, migrations, FeatureKeys, `usePlan().can()`, `PremiumLockModal`, `AuthGate`, Mercado Pago, WhatsApp, OCR Vision/Gemini, Google Maps, importador Joanin, rate-limit.

---

## 2. Nova arquitetura de navegação

Mantém as rotas existentes (sem renomear nada para não quebrar links/preload), e introduz uma camada visual unificada:

```text
/mercado                       → Home estilo app supermercado (redesign)
  ├─ busca global (header)     → /mercado/buscar (novo, opcional fase 3)
  ├─ chips de categoria        → filtros sobre produtos/preço comunitário
  ├─ atalhos rápidos           → listas, carrinho, mercados, importar
  ├─ vitrines                  → ofertas, comunitário, em destaque
  └─ blocos contextuais        → lista atual, orçamento, mercado preferido

Rotas existentes (mantidas):
  /mercado/listas, /mercado/carrinho, /mercado/orcamento,
  /mercado/historico, /mercado/calculadoras, /mercado/mercados,
  /mercado/meus-mercados, /mercado/precos, /mercado/cesta,
  /mercado/importar-cupom, /mercado/preco-comunitario
```

Componentes novos compartilhados (em `src/components/mercado/shell/`):
- `MercadoHeader` — header sticky com saudação, mercado atual selecionável e campo de busca.
- `MercadoCategoryChips` — chips visuais (Hortifruti, Açougue, Padaria, Bebidas, Laticínios, Limpeza, Mercearia, Utilidades).
- `MercadoBanner` — banner responsivo com slot para imagem/ilustração + CTA.
- `MercadoShowcase` — vitrine horizontal (scroll-snap) de cards.
- `ProductCard` — card unificado de produto (imagem, nome, preço, unidade, mercado, origem, data, CTA "+ lista").
- `MarketBadge` — badge do mercado (logo + nome curto).
- `SectionBlock` — wrapper padronizado para seções da home (título + ver todos).

Tudo consumindo tokens semânticos de `src/styles.css` (sem cores hardcoded).

---

## 3. Linguagem visual unificada

- **Tokens**: adicionar em `src/styles.css` (oklch) tokens específicos do módulo: `--mercado-fresh` (hortifruti), `--mercado-meat`, `--mercado-bakery`, `--mercado-drinks`, `--mercado-cleaning`, `--mercado-pantry`, mapeando para acentos coerentes com `--brand`.
- **Cantos**: `rounded-2xl/3xl` consistente (já é o padrão do hub).
- **Sombras**: `shadow-card` e `shadow-elevated` já existentes.
- **Tipografia**: títulos `text-2xl md:text-3xl font-bold tracking-tight`; section headers `text-base font-semibold`.
- **Áreas de toque**: mínimo 44px (mantém padrão atual do `BottomNav`/`MobileTopBar`).
- **Mobile-first**: 1 coluna < md, 2 colunas md, 3 colunas xl (mesma grade do hub atual).

---

## 4. Nova Home — `/mercado`

Hierarquia proposta (mobile-first, top→bottom):

```text
┌─────────────────────────────────────┐
│ Header: "Olá, {nome}"               │
│ [Mercado atual ▾]   [🔔]            │
│ [🔍 Buscar produto, marca ou preço] │
├─────────────────────────────────────┤
│ BANNER principal (ilustração + CTA) │
│ "Economize na sua próxima compra"   │
├─────────────────────────────────────┤
│ Chips: Hortifruti · Açougue · …     │
├─────────────────────────────────────┤
│ Atalhos rápidos (grid 4 col mobile):│
│ Lista · Carrinho · Importar · Cesta │
├─────────────────────────────────────┤
│ Vitrine: Preço Comunitário em alta  │
│ → ProductCard horizontal scroll     │
├─────────────────────────────────────┤
│ Bloco: Sua lista em andamento       │
│ (ou empty state "Criar lista")      │
├─────────────────────────────────────┤
│ Bloco: Orçamento do mês             │
│ barra de progresso + restante       │
├─────────────────────────────────────┤
│ Bloco: Mercados próximos (mini-map) │
│ + 3 cards de mercados favoritos     │
├─────────────────────────────────────┤
│ Vitrine: Importar/cadastrar preços  │
│ (Cupom · Panfleto · Online · Manual)│
├─────────────────────────────────────┤
│ Rodapé: explorar tudo (link p/ hub  │
│ completo com os 11 cards atuais)    │
└─────────────────────────────────────┘
```

O hub atual de 11 cards vira `/mercado/explorar` (mesma rota técnica, view alternativa) ou um collapse "Ver todas as ferramentas" no fim da home — mantendo descoberta sem poluir.

---

## 5. Redesign por tela (resumo)

| Tela | Mudança UX/UI |
|---|---|
| Home `/mercado` | Reescrita conforme §4. |
| Listas | Header com chip de mercado, agrupamento por categoria, ProductCard, totalizador sticky. |
| Carrinho | Layout estilo checkout (itens + resumo + CTA), subtotal por categoria. |
| Orçamento | Barra de progresso grande, anel/gráfico, comparativo mês anterior. |
| Histórico | Timeline visual por compra com totais e mercado. |
| Calculadoras | Tabs internas; inputs grandes; resultado destacado. |
| Mercados próximos | Mini-mapa fixo no topo + lista cards com logo + distância + CTA favoritar. |
| Meus mercados | Cards grandes com logo, "definir como atual", endereço, ações. |
| Preço Comunitário | ProductCard com selo "Comunitário", origem (Joanin/Cupom/Manual), data, foto futura. Estados vazios ilustrados. Fluxo de importação com banner contextual. |
| Importar Cupom/Panfleto/Online/Manual | Wizard unificado com banner ilustrado por origem; passos numerados. |
| Cesta básica | Cards de produto agrupados por categoria com totais. |
| Busca (novo) | Campo dedicado, sugestões, filtros (mercado, categoria, origem), resultados em ProductCard. |
| Produto (novo, opcional) | Tela de detalhe com imagem, histórico simples de preço, mercados onde foi visto, CTA adicionar à lista. |

---

## 6. Banners e ilustrações

Gerar com `imagegen` (premium para hero, fast para demais), salvar em `src/assets/mercado/`:
- `hero-home.jpg` — sacola, carrinho moderno, paleta brand.
- `cat-hortifruti.png` (transparente) — frutas/verduras estilizadas.
- `cat-acougue.png`, `cat-padaria.png`, `cat-bebidas.png`, `cat-laticinios.png`, `cat-limpeza.png`, `cat-mercearia.png`, `cat-utilidades.png`.
- `banner-comunitario.jpg` — etiquetas/panfleto, sensação colaborativa.
- `banner-mercados.jpg` — mapa + pin + carrinho.
- `banner-orcamento.jpg` — economia/planejamento.
- `empty-lista.png`, `empty-carrinho.png`, `empty-comunitario.png` — estados vazios amigáveis.

Todos responsivos, `loading="lazy"`, com fallback em cor sólida do token.

---

## 7. i18n

Todas as strings novas vão para `src/i18n/locales/pt/mercado.json` e `en/mercado.json` mantendo paridade total. Nenhum texto hardcoded. Namespaces sugeridos: `mercado:home.hero`, `mercado:home.shortcuts`, `mercado:home.showcase.*`, `mercado:categories.*`, `mercado:product.*`, `mercado:search.*`.

---

## 8. Plano de execução em etapas

Cada etapa é independente, mergeável e não quebra as anteriores.

**Etapa 1 — Fundação visual (sem mudar telas)**
- Adicionar tokens de categoria em `src/styles.css`.
- Criar `src/components/mercado/shell/` com `MercadoHeader`, `SectionBlock`, `MercadoCategoryChips`, `MercadoBanner`, `MercadoShowcase`, `ProductCard`, `MarketBadge`.
- Gerar primeiro lote de assets (hero + 8 categorias + 3 banners + 3 empty states).
- Adicionar chaves i18n base PT/EN.

**Etapa 2 — Nova Home `/mercado`**
- Reescrever `src/routes/mercado.tsx` com a hierarquia da §4.
- Reaproveitar dados já disponíveis (lista atual, orçamento, mercados favoritos, preço comunitário recente) — apenas leitura, sem novas mutações.
- Manter acesso aos 11 destinos atuais via atalhos + bloco "Explorar tudo" no fim.

**Etapa 3 — Preço Comunitário (continuidade do trabalho recente)**
- Aplicar `ProductCard`, banners e estados vazios ilustrados em `mercado_.preco-comunitario.tsx`.
- Não tocar no `OnlineImportWizard`/API Joanin/migration de source.

**Etapa 4 — Listas & Carrinho**
- Agrupar por categoria, totalizador sticky, ProductCard.

**Etapa 5 — Mercados próximos & Meus mercados**
- Mini-mapa no topo, cards grandes, seletor de mercado atual unificado com o header.

**Etapa 6 — Orçamento, Histórico, Cesta, Calculadoras**
- Aplicar `SectionBlock`, hierarquia e ilustrações.

**Etapa 7 — Busca global (novo) e tela de Produto (novo)**
- Adicionar rotas `/mercado/buscar` e `/mercado/produto/$id` (opcional, após validação das etapas 1-6).

**Etapa 8 — Polimento**
- Animações leves (framer-motion já no projeto), revisão de contraste, QA mobile/Android WebView, auditoria de paridade i18n.

---

## 9. Riscos e mitigação

- **Regressão de planos/gates**: todos os atalhos novos passam por `usePlan().can(feature)` igual ao hub atual; lock continua via `PremiumLockModal`.
- **Performance mobile**: assets `lazy`, `srcset` quando aplicável, ilustrações PNG transparentes pequenas (<60kb).
- **Quebra de links**: rotas existentes preservadas; apenas a view do hub muda.
- **i18n**: PR só passa se PT/EN tiverem as mesmas chaves (checar antes de cada etapa).

---

## 10. O que entrego ao aprovar este plano

Começo pela **Etapa 1 (fundação visual)** + **Etapa 2 (nova Home)** no próximo turno: tokens, componentes do shell, primeiros assets gerados via IA, nova `mercado.tsx`, i18n PT/EN. Sem tocar em lógica de negócio, sem migrations, sem mexer em integrações.

Confirma que posso seguir por aí, ou prefere reordenar (ex.: começar por Preço Comunitário antes da Home)?
