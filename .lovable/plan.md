# Imagens automáticas de produtos — plano em 2 fases

Objetivo: enriquecer cards/vitrines/listas/carrinho do Mercado Inteligente com fotos reais quando disponíveis, mantendo fallback bonito e sem quebrar nada.

A entrega é dividida em 2 fases para evitar uma única PR enorme que toca em 6 fluxos de cadastro + schema + UX ao mesmo tempo. Cada fase é independente e gera valor.

---

## Fase 1 — Fundação (sem schema novo, valor imediato)

### 1.1 Endpoint server-side seguro
Criar `src/lib/mercado/product-image.functions.ts` com `lookupProductImage` (server fn `POST`, protegido por `requireSupabaseAuth`).

Entrada (Zod):
- `productName: string` (min 2, max 200)
- `brand?: string` (max 100)
- `barcode?: string` (apenas dígitos, 8–14)
- `category?: string` (uma das chaves de `MercadoCategoryKey`)

Saída:
```ts
{
  imageUrl: string | null;
  source: "off_barcode" | "off_search" | "brand_logo" | "fallback" | null;
  confidence: "high" | "medium" | "low" | null;
  origin: "openfoodfacts" | "local" | null;
  checkedAt: string; // ISO
}
```

### 1.2 Estratégia de busca (ordem)
1. **OFF por barcode** — `https://world.openfoodfacts.org/api/v2/product/{barcode}.json` → `image_front_url` → `high` / `off_barcode`.
2. **OFF por nome+marca** — `https://world.openfoodfacts.org/cgi/search.pl?...&json=1&page_size=3`, pega o primeiro com imagem e nome similar (similaridade ≥ 0.55 via Dice/Levenshtein curto) → `medium` / `off_search`.
3. **Logo de marca local** — se `brand` casar (case-insensitive) com algum SVG em `public/logos/empresas/*.svg`, devolve URL do logo → `low` / `brand_logo` (sempre marcado como "logo de marca", não foto do produto).
4. **Sem imagem** → `null` (o front cai no fallback visual por categoria já existente no `ProductCard`).

Regras de segurança server-side:
- Validação Zod estrita (sem chars de injeção em URL — usar `URL`/`encodeURIComponent`).
- Whitelist de hosts permitidos no retorno (`images.openfoodfacts.org`, `world.openfoodfacts.org`, `/logos/empresas/*`). Qualquer outra origem é descartada.
- Timeout de 4s por chamada externa (`AbortSignal.timeout(4000)`).
- Nenhum secret usado (OFF é público); nada exposto ao client além da URL pública final.
- Em qualquer erro/timeout: retorna `{ imageUrl: null, ... }` sem propagar exception.

### 1.3 Cache
- **Server-side (in-memory por worker)** — `Map<string, { value, expiresAt }>` com TTL de 24h e cap de 500 entradas (LRU simples). Chave: `normalize(name) + "|" + normalize(brand) + "|" + barcode`. Evita rebatimento em rajadas.
- **Client-side** — wrapper `useProductImage(input)` (React Query) com `staleTime: 1h`, `gcTime: 24h`, `queryKey` igual à chave acima. Garante deduplicação e lazy fetch.

### 1.4 Hook + componente de imagem
Criar `src/lib/mercado/use-product-image.ts` (`useProductImage`) e atualizar `ProductCard` para:
- Se `imageUrl` (prop, já vindo do banco/usuário) existir → usa direto (prioridade máxima, nunca sobrescrever).
- Senão, chamar `useProductImage({ name, brand, barcode, category })` lazy (apenas quando o card entra no viewport via `IntersectionObserver` simples ou `loading="lazy"` no `<img>`).
- Se a hook retornar URL → renderiza com badge discreto "imagem sugerida" (chip `text-[10px]` no canto inferior esquerdo).
- Se falhar a carregar → cai no `Fallback` por categoria já implementado.
- `ProductCard` ganha props opcionais novas: `brand?`, `barcode?`, `category?: MercadoCategoryKey`. Compatível para trás (todos os call-sites continuam funcionando sem mudança).

### 1.5 Aplicação inicial (read-only, sem mudar store)
Atualizar os 3 call-sites de `ProductCard` para passar `brand/barcode/category` quando o registro tiver esses dados:
- `src/routes/mercado_.precos.tsx` (recent finds + results) — passa `brand`, `barcode` se vierem da tabela.
- `src/routes/mercado_.preco-comunitario.tsx`
- `src/routes/mercado.tsx` (home vitrine)

Nenhuma migration nesta fase. Nenhum store alterado. A imagem é puramente derivada/cacheada — se falhar, o fallback bonito atual continua.

### 1.6 i18n PT/EN
Adicionar em `src/i18n/locales/{pt,en}/mercado.json` no namespace `shell.product`:
- `suggestedImage`: "imagem sugerida" / "suggested image"
- `brandLogoHint`: "logo da marca" / "brand logo"

---

## Fase 2 — Persistência e enriquecimento (depois que Fase 1 estiver validada)

Adiada conscientemente para uma segunda etapa porque exige migration + ajustes em múltiplos stores. **Não será feita agora.**

Escopo previsto:
- Migration adicionando colunas em `community_prices` (e tabelas análogas se houver): `image_url`, `image_source`, `image_confidence`, `image_origin`, `image_checked_at`.
- Server fn `enrichProductImage` que, ao gravar um item novo, faz lookup em background e atualiza a linha (não bloqueia o INSERT).
- Aplicação nos 6 fluxos de cadastro citados (Preço Comunitário, Importação online, OCR panfleto, Lista, Carrinho, Cadastro manual).
- UI de revisão/remover/trocar imagem sugerida no fluxo OCR.
- Quando Fase 2 chegar, a Fase 1 continua útil: ela serve como fallback dinâmico para registros antigos sem imagem persistida.

---

## Arquivos da Fase 1

Criados:
- `src/lib/mercado/product-image.functions.ts` — server fn `lookupProductImage`
- `src/lib/mercado/product-image-cache.server.ts` — LRU server-side
- `src/lib/mercado/use-product-image.ts` — hook React Query

Alterados:
- `src/components/mercado/shell/ProductCard.tsx` — props opcionais + integração com hook + badge "sugerida"
- `src/routes/mercado_.precos.tsx`, `mercado_.preco-comunitario.tsx`, `mercado.tsx` — passar `brand/barcode/category`
- `src/i18n/locales/pt/mercado.json`, `src/i18n/locales/en/mercado.json` — chaves novas

Preservado integralmente: RLS, Auth, planos, FeatureKeys, AuthGate, PremiumLockModal, Mercado Pago, WhatsApp, OCR Vision/Gemini, Joanin Import, Google Maps, stores (`listas-store`, `mercados-store`, `community-prices-suggestions`), cálculos, validações, rotas existentes, schema do banco.

---

## Por que dividir assim

- Fase 1 entrega ~70% do valor visual (cards passam a mostrar fotos reais quando OFF tem) com risco mínimo: sem migration, sem alterar stores, sem alterar fluxos de cadastro.
- Fase 2 fica isolada para quando você quiser persistir + permitir override manual, que é onde mora a complexidade real (RLS por tabela, UI de revisão, backfill).

Posso começar pela Fase 1 assim que aprovar?
