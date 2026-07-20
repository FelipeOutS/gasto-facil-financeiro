## Diagnóstico atual

- `/` (`src/routes/index.tsx` → `IndexGate`) hoje faz duas coisas: se **não** tem sessão → renderiza `PublicLanding`; se **tem** sessão → renderiza o `Index` (dashboard).
- Existe um caminho onde `IndexGate` **redireciona para `/login`**: quando a bridge biométrica nativa está disponível (`isLoginBioBridgeAvailable && isLoginBioEnabled`) ou quando exige unlock (`isLoginBioUnlockRequired`). É o que dispara o comportamento reportado ("acessa a raiz e vai pra /login") em dispositivos onde o WebView expôs a bridge biométrica ou onde ficou `bio-unlock=required` em `sessionStorage`.
- O botão "Voltar para o início" em `AuthGate.tsx` L268-274 já é um `<Link to="/">`. Ele "não faz nada" para usuário logado porque `/` re-renderiza a mesma tela (dashboard/loader) sem mudar de rota; ou porque o `GuestOnly` do `/login` intercepta antes o teste do usuário.
- `/landing` já redireciona para `/` (`src/routes/landing.tsx`).

## Decisão pedida pelo usuário

Item 1: `/` deve **sempre** abrir a landing pública — inclusive para usuário logado. Item 5: nada pode interceptar `/`. Isso obriga a mover o dashboard para uma rota própria (`/app`).

## Mudanças

### 1. `/` fica 100% público e sempre landing

`src/routes/index.tsx`:
- Substituir `IndexGate` por um componente simples que sempre renderiza `<PublicLanding />`.
- Remover todos os `useEffect` de biometria dessa rota (não redireciona para `/login` sob nenhuma condição).
- Remover a lógica do `Index` (dashboard) deste arquivo — passa a viver em `src/routes/app.tsx`.

### 2. Dashboard passa a viver em `/app`

`src/routes/app.tsx`:
- Hoje é um redirect-bridge para `/`. Trocar para renderizar o `Index` (dashboard) diretamente, dentro de `<AuthGate>`.
- Se usuário não logado acessar `/app` → `AuthGate` já redireciona para `/login` (comportamento correto).
- Manter o timeout/boot loader existente.

### 3. Atualizar navegações internas

- Login/cadastro/reset após sucesso → `navigate({ to: "/app" })` (hoje vai para `/`).
- `/app` como destino para "voltar ao dashboard" já é o padrão em todo o codebase (`to: "/app"` já é usado extensamente) — nada a alterar.
- Logo do `AuthShell` continua `to="/"` (leva o usuário à landing).
- Botão "Voltar para o início" no login continua `to="/"` — funcionará porque `/` agora é sempre landing e não faz mais redirect condicional.
- Sign-out: manter destino atual (`/login`) — não altera a rota inicial pública.

### 4. Biometria e sessão expirada

- Bridge biométrica: mover o "sugerir login biométrico ao abrir o app" para `/app` (dentro do `AuthGate`), não para `/`.
- Sessão expirada em rota privada → continua indo para `/login` via `AuthGate` (comportamento atual). `/` nunca intercepta.

### 5. `/landing` legado

Já corrigido em turno anterior — verificar que continua redirecionando para `/` com `replace: true`. Nenhuma mudança nova.

### 6. Verificações

- `rg` por `to: "/"` / `to="/"` em componentes de dashboard/redirect pós-login e trocar para `/app` apenas onde o intuito era "voltar ao dashboard".
- Garantir que nenhum `beforeLoad` ou `AuthGate` cobre a rota `/`.
- Confirmar que `PublicLanding` não depende de `useAuth().session`; se depender, aceitar `session` opcional e mostrar CTA "Entrar" / "Ir para o app" conforme.

### 7. Testes, build e publish

- Rodar suíte (`bun test`) para confirmar zero regressão.
- Build de produção.
- Publish + confirmar propagação em `gastointeligente.com.br`, `/login`, `/app`, `/landing`.

## Impacto

- Dashboard muda de URL: `/` → `/app`. Bookmarks antigos de usuários no dashboard passarão pela landing pública (com CTA "Entrar"/"Abrir app"). Aceitável e desejado pelo pedido.
- SEO da raiz melhora (sempre HTML público indexável).
- Zero mudança em código de negócio, RLS ou WhatsApp.

## Riscos

- Componentes do dashboard que hoje usam `useNavigate({ to: "/" })` para "voltar" precisarão apontar para `/app`. Levantar todas as ocorrências e ajustar apenas as com intenção de dashboard.
- `PublicLanding` renderizado para usuário logado: adicionar um CTA discreto "Ir para o app" no topo quando `session` existir, sem forçar redirect.

Confirma esse plano para eu executar?