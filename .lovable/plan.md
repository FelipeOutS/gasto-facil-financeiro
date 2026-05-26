## Escopo

Apenas o **modo mobile** (`<lg`, breakpoint 1024px). Desktop e tablet permanecem idênticos. Nenhuma mudança em Supabase, RLS, cálculos, planos, MP, WhatsApp, IA, offline sync, AuthGate, Android WebView ou rotas premium.

## Mudanças propostas

### 1. `MobileTopBar.tsx` — redesenhar
Hoje: logo à esquerda, sino + avatar à direita, altura `h-12`.
Novo (mobile-only):
- **Esquerda**: botão hambúrguer (abre Sheet de "Mais opções")
- **Centro-esquerda**: avatar do usuário + saudação ("olá," em muted, **Nome** em destaque)
- **Direita**: sino de notificações com badge (mantém comportamento atual)
- Logo `BrandMark` discreta no canto direito acima do sino, OU removida do top bar (já aparece dentro do Sheet). Vou manter discreta no Sheet, fora do header — header fica respirado.
- Altura `h-16`, mais respiro, `safe-top` mantido.
- Bug colateral: `h-4.5 w-4.5` (classe Tailwind inválida) → corrigir para `h-5 w-5`.

### 2. Novo componente `MobileMoreSheet.tsx`
Sheet lateral (shadcn `Sheet` side="left") aberto pelo hambúrguer. Reaproveita `nav-groups.ts` (já existe) para listar:
- **Financeiro**: Dashboard, Gastos, Minha renda, Contas a pagar, Contas a receber, Assinaturas, Cartões
- **Planejamento**: Orçamento, Metas, Guardado, Investimentos
- **Empresa**: Empresa Inteligente, Clientes, Fornecedores, Contador
- **Conta**: Relatórios, Alertas, Meu Plano, Perfil, Ajustes
Cada item respeita os locks premium/permissões já existentes (reusar componentes/lógica atuais — sem duplicar).

### 3. `BottomNav.tsx` — botão central destacado
Hoje: 5 tabs flat (Início, Gastos, Cartões, Metas, Mais).
Novo: **5 tabs com o centro como FAB**:
- Início · Gastos · **[+] FAB verde** · Relatórios · Mais
- FAB central abre um popover/sheet com: Novo gasto, Nova receita, Importar, IA financeira (rotas já existentes: `/adicionar`, `/gastos`, etc.)
- Mantém badges de alerta atuais.

### 4. Novo `MobileMonthSummary.tsx` (mobile-only, `lg:hidden`)
Bloco inserido **no topo do Dashboard** acima dos cards existentes:
- Header: "resumo de {mês}" com seletor de mês já existente (`MesSwitcher`/`useMesReferencia`) reaproveitado
- Card grande de **Saldo atual** (ícone + valor, botão olho para ocultar — opcional, fora de escopo se complexo)
- Grid 2×2 com: Receitas · Despesas · Recebidas · Pagas
- Usa valores **já calculados** em `index.tsx` — vou passar via props ou ler do mesmo lugar.

### 5. `routes/index.tsx` — pequena reorganização mobile
- Esconder o KPI bar atual no mobile (`hidden lg:block`) e mostrar `<MobileMonthSummary />` no lugar (`lg:hidden`).
- Manter todos os demais cards (Radar, Saúde, Diagnóstico, Impacto, Calendário, Atividade, Contas, Cartões etc.) intactos — eles já são responsivos.
- Nenhuma remoção de funcionalidade.

## O que NÃO vou alterar

- Layout desktop/tablet (toda mudança guardada atrás de `lg:hidden` / `<useIsMobile>`).
- `src/routes/index.tsx` lógica de dados — só rearranjo visual mobile.
- Cálculos, hooks, queries, Supabase, RLS, planos, MP, WhatsApp, IA, offline, AuthGate, biometria, Android WebView.
- `/orcamento`, `/relatorios`, `/alertas`, `/meu-plano`, `src/lib/alerts/*`.
- BrandMark, tema, tokens semânticos.

## Como testar

1. Mobile 360/390/430px: header novo, hambúrguer abre sheet com grupos, FAB central abre ações rápidas, Resumo do mês no topo com saldo + grid 2×2.
2. Desktop ≥1024px: layout idêntico ao atual (sidebar, KPI bar tradicional).
3. Dark/light: tokens semânticos, sem hardcoded.
4. Sem scroll horizontal, sem overflow, FAB não sobrepõe conteúdo (padding inferior já existe).

## Arquivos

**Editados**: `src/components/MobileTopBar.tsx`, `src/components/BottomNav.tsx`, `src/routes/index.tsx` (inserir bloco mobile + esconder KPI bar atual no mobile).
**Criados**: `src/components/MobileMoreSheet.tsx`, `src/components/MobileMonthSummary.tsx`, `src/components/MobileQuickActionsSheet.tsx` (popover do FAB).

Posso seguir?
