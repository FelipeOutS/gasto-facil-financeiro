# Logos automáticos globais (Logo.dev + cache)

## Objetivo
Componente `BrandLogo` global que resolve logos por domínio via Logo.dev, com cache em banco, normalização de nomes e fallback elegante. Aplicar em todos os pontos do app onde aparece nome de empresa/banco/serviço — sem quebrar layout existente.

## 1. Banco de dados (1 migration)

**Tabela `brand_assets`** (cache global por domínio)
- `id`, `domain` (unique), `company_name`, `normalized_name`
- `logo_url`, `primary_color`, `secondary_color`
- `source` ('logo.dev' | 'manual'), `status` ('found' | 'not_found' | 'manual')
- `last_checked_at`, `created_at`, `updated_at`
- Índice em `domain` e `normalized_name`
- RLS: leitura pública autenticada; escrita só via service role (server fn)

**Tabela `merchant_brand_aliases`** (nome digitado → domínio)
- `id`, `user_id` (nullable), `merchant_name`, `normalized_merchant_name`
- `domain`, `confidence`, `source` ('automatic' | 'user' | 'global')
- timestamps + índice em `normalized_merchant_name`
- RLS: usuário lê seus próprios + aliases globais (user_id IS NULL); só edita os próprios

Trigger `updated_at` reaproveitando função existente.

## 2. Normalização (`src/lib/brand/normalize.ts`)
`normalizeMerchantName(input)`:
- lowercase, remove acentos (NFD), remove caracteres não alfanuméricos
- remove stop-words: `pagamento|compra|pix|boleto|transferencia|debito|credito|loja|ltda|sa|eireli|me|comercio|assinatura|mensalidade|plano|cartao|*compra|brl`
- normaliza espaços; preserva núcleo do nome

## 3. Resolver (`src/lib/brand/resolver.ts`)
Ordem:
1. Cache em memória (Map) por nome normalizado
2. `merchant_brand_aliases` (próprios + globais)
3. `brand_assets` por domínio se já houver
4. Heurística: mapa seed (nubank, mercado pago, hotmart, lovable, etc.) + `guessDomainsFromName` (`.com.br`, `.com`, `.io`, `.dev`, `.app`, `.co`)
5. Se nada bater → fallback iniciais

Server fn `resolveBrand({ name, domain? })`:
- consulta DB, se vazio testa candidatos contra Logo.dev (HEAD/GET), salva resultado em `brand_assets` (status found/not_found) e alias se aplicável

## 4. Componente `BrandLogo` (`src/components/brand/BrandLogo.tsx`)
Props: `name`, `domain?`, `size` (sm/md/lg), `rounded`, `className`, `fallbackIcon?`, `variant?` ('square'|'circle')

Cascata client-side:
- Se `domain` conhecido → `https://img.logo.dev/${domain}?token=${VITE_LOGO_DEV_KEY}&size=128&format=png`
- onError → fallback DuckDuckGo / Google s2 favicon (re-usa `company-logo.ts` existente)
- onError final → círculo com inicial e cor estável (`colorFor`)
- Lazy load, decoding async, sem flash (mantém último carregado)

Chave pública Logo.dev em `VITE_LOGO_DEV_KEY` (publishable token — ok no frontend).

## 5. Aplicação global
Refatora `TransactionAvatar` e `BrandLogo` legado para delegar ao novo componente quando não houver logo local em `/public/logos/*` (mantém logos locais com prioridade — já são SVGs otimizados).

Pontos aplicados:
- `TransactionAvatar` (gastos, lista, detalhe, recorrentes, importações)
- Cards de cartões (`src/routes/cartoes.tsx`)
- Bancos / `dinheiro_guardado` (`src/routes/guardado.tsx`)
- Assinaturas (`src/routes/assinaturas.tsx`)
- Clientes / Fornecedores (avatar com logo do CNPJ)
- Contas a pagar / receber
- Cofre Pessoal (já usa `CompanyLogo` — migra para `BrandLogo`)
- Dashboard insights de cartões/empresas

## 6. Segurança / chaves
- Logo.dev publishable key (`pk_*`) usada direto no frontend via `VITE_LOGO_DEV_KEY`.
- Se usuário quiser API privada (cores, search): adiciona secret `LOGO_DEV_SECRET` + server fn proxy. Não bloqueia esta entrega.
- RLS conforme tabela 1.

## 7. Correção manual
Reutiliza painel já existente do Cofre Pessoal; adiciona menu "Corrigir logo" em `EntryDetail` que abre input de domínio e grava alias.

## 8. Não-quebrar
- Mantém todos os logos locais em `public/logos/*` com prioridade.
- Não toca em rotas, auth, RLS de outras tabelas, planos.
- Layouts atuais inalterados — só substitui o avatar interno.

## Arquivos novos
- `supabase/migrations/<ts>_brand_assets.sql`
- `src/lib/brand/normalize.ts`
- `src/lib/brand/resolver.ts`
- `src/lib/brand/brand.functions.ts` (server fn `resolveBrand`)
- `src/components/brand/BrandLogo.tsx`

## Arquivos editados
- `src/components/TransactionAvatar.tsx` (cascade fallback → BrandLogo)
- `src/components/BrandLogo.tsx` legado → re-export do novo (mantém API)
- `src/components/vault/CompanyLogo.tsx` → wrapper do novo BrandLogo
- `.env` referência a `VITE_LOGO_DEV_KEY` (precisa do usuário adicionar)

## Pergunta antes de prosseguir
A chave Logo.dev `pk_X-1ZO13ESQOXMI5MlVUVQQ` (já usada no Cofre Pessoal) é a do usuário? Se sim, reutilizo. Se houver chave nova, peço via secret.
