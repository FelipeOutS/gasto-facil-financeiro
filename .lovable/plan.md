## Objetivo

Adicionar troca de idioma PT-BR / EN no site inteiro do Gasto Inteligente, com URLs por idioma (`/pt/...` e `/en/...`), seletor visível na landing e dentro da área logada, persistência da escolha e SEO multilíngue (hreflang).

## Estratégia de URLs

Como o app tem ~60 rotas em `src/routes/`, **não vou duplicar fisicamente cada arquivo**. Em vez disso:

- O idioma vira um **search param** global (`?lang=pt|en`) validado no `__root.tsx` com `retainSearchParams`, garantindo que ele se preserve em toda navegação interna.
- Adiciono **rotas de redirect** estáticas `/pt` e `/en` (e `/pt/$` e `/en/$` splat) que recebem `/pt/qualquer/coisa` e fazem `redirect` para `/qualquer/coisa?lang=pt|en`. Assim:
  - URLs públicas tipo `gastointeligente.com.br/pt/landing` e `/en/landing` funcionam para SEO/compartilhamento.
  - Internamente o roteamento atual (`/landing`, `/conta`, etc.) continua intacto — zero refactor de 60 arquivos.
  - O `i18n` lê o idioma de `useSearch({ strict: false }).lang` ou do `localStorage` como fallback.
- O sitemap passa a listar cada rota em `/pt/...` e `/en/...` com `<xhtml:link rel="alternate" hreflang>`.
- `__root.tsx` adiciona `<link rel="alternate" hreflang="pt-BR">` e `hreflang="en">` na tag `<head>` baseado na rota atual.

Essa abordagem entrega o objetivo (URLs por idioma + SEO) sem reescrever a árvore inteira de rotas.

## Escopo de tradução

Como o usuário pediu **site inteiro**, vou:

1. Configurar a infra completa de i18n (esta entrega).
2. Traduzir nesta entrega: landing pública, header/footer, navegação (BottomNav, DesktopSidebar, MoreSheet), página de login/cadastro/recuperar senha, conta, perfil, ajustes, meu plano, páginas legais (termos, privacidade, lgpd).
3. Marcar como **trabalho seguinte** (segunda iteração) a tradução de: dashboard, gastos, cartões, contas a pagar/receber, clientes, fornecedores, relatórios, investimentos, metas, orçamento, radar, contador, admin, alertas, AI, e todos os modais/diálogos. São muitas strings — fazer em uma única passada explode o tamanho do PR e quase garantido introduz bugs visuais. Aviso isso explicitamente no fim.

## Detalhes técnicos

### Dependências
- `bun add i18next react-i18next i18next-browser-languagedetector`

### Arquivos novos
- `src/i18n/index.ts` — inicialização do i18next, detector custom (URL `lang` param → localStorage → navegador → `pt`).
- `src/i18n/locales/pt/common.json` — namespace `common` (header, nav, botões genéricos, footer).
- `src/i18n/locales/pt/landing.json` — todas as strings de `PublicLanding.tsx`.
- `src/i18n/locales/pt/auth.json` — login, cadastro, recuperar/reset senha.
- `src/i18n/locales/pt/account.json` — conta, perfil, ajustes, meu plano.
- `src/i18n/locales/pt/legal.json` — termos, privacidade, LGPD.
- `src/i18n/locales/en/*.json` — equivalentes em inglês.
- `src/i18n/use-locale.ts` — hook que sincroniza `lang` (search param) ↔ `i18n.changeLanguage()` ↔ `localStorage.gi-lang` ↔ `<html lang>`.
- `src/components/LanguageSwitcher.tsx` — dropdown com globo (lucide `Globe`), aria-label, suporte a teclado, mostra "PT" / "EN".
- `src/routes/pt.$.tsx` e `src/routes/en.$.tsx` — splat routes que fazem `redirect()` para a rota equivalente sem prefixo, anexando `?lang=pt|en`.
- `src/routes/pt.tsx` e `src/routes/en.tsx` — redirect de `/pt` e `/en` para `/landing?lang=...`.

### Arquivos editados
- `src/routes/__root.tsx` — `validateSearch` para `lang`, `search.middlewares: [retainSearchParams(["lang"])]`, importa e inicializa `src/i18n`, atualiza `<html lang>` via `useLocale`, adiciona `<link rel="alternate" hreflang>` no head.
- `src/components/landing/PublicLanding.tsx` — adiciona `<LanguageSwitcher />` no header ao lado do botão "Entrar"; troca strings hardcoded por `t("...")`.
- `src/routes/conta.tsx` — adiciona seção "Idioma / Language" com o `LanguageSwitcher` (variante inline).
- `src/routes/perfil.tsx` ou nova rota `src/routes/ajustes.tsx` — preferência de idioma também acessível aqui (linka da `conta.tsx`).
- `src/routes/sitemap[.]xml.ts` — gera URLs em `/pt/...` e `/en/...` com `xhtml:link` hreflang.
- `src/routes/login.tsx`, `src/routes/cadastro.tsx`, `src/routes/recuperar-senha.tsx`, `src/routes/reset-password.tsx` — strings via `t()`.
- `src/routes/termos.tsx`, `src/routes/privacidade.tsx`, `src/routes/lgpd.tsx` — strings via `t()` (textos legais traduzidos).
- `src/components/BottomNav.tsx`, `src/components/DesktopSidebar.tsx`, `src/components/MoreSheet.tsx` — labels via `t()`.

### Persistência
- Chave `gi-lang` no `localStorage`. Prioridade de leitura no boot: search param `lang` > localStorage > `navigator.language` (pt-* → pt, resto → en) > `pt`.
- Trocar idioma: atualiza `i18n`, salva no localStorage, navega com `search: (prev) => ({ ...prev, lang })` para o param ficar persistente em links.

### SEO
- `__root.tsx` injeta dois `<link rel="alternate" hreflang="pt-BR" href="https://gastointeligente.com.br/pt{pathname}">` e `hreflang="en"`, mais `hreflang="x-default"` apontando para PT.
- `sitemap.xml` lista as duas versões.
- `<html lang>` reage à mudança via `useEffect` em `useLocale`.

### Acessibilidade
- `LanguageSwitcher` usa `DropdownMenu` do shadcn (já instalado), com `aria-label="Selecionar idioma"`, navegável por Tab/Enter/Setas, indicador visual do idioma atual.

## Validação

- `bun run build` precisa passar.
- Testar manualmente: trocar idioma na landing → texto muda, URL ganha `?lang=en`, refresh preserva, navegar para `/conta` preserva. Acessar `/en/landing` direto → redireciona para `/landing?lang=en` com UI em inglês. localStorage guarda escolha.

## Fora do escopo (entregas seguintes)

Tradução das strings de: dashboard, gastos, cartões, contas a pagar/receber, clientes, fornecedores, relatórios, investimentos, metas, orçamento, radar, contador, admin, alertas, gasto-ai, e todos os componentes/modais auxiliares. A infra ficará pronta — cada página subsequente vira só "extrair strings + adicionar a `pt/en.json`".
