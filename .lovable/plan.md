# Plano de Organização de UX e Navegação - Fase 1

Esta fase foca na consolidação de rotas redundantes, limpeza da navegação mobile e implementação do "Smart Menu" baseado no perfil do usuário (PF/MEI/Empresa).

## Alterações Estruturais

### 1. Smart Menu por Perfil
- Alterar `src/lib/nav-groups.ts` para que a função `filterVisibleGroups` também filtre pelo tipo de cadastro do usuário.
- O grupo "Empresa" (`id: "empresa"`) será ocultado para usuários com `tipo_cadastro === "pessoa_fisica"`.

### 2. Unificação de Rotas de Perfil
- A rota canônica para visualização será `/conta`.
- A rota canônica para edição será `/perfil`.
- Transformar `/app/perfil` (que hoje é um hub de atalhos mobile) em um redirect para `/conta`.
- O menu lateral e o menu "Mais" (mobile) apontarão diretamente para `/conta`.

### 3. Limpeza do Menu "Mais" (Mobile)
- Remover itens redundantes em `src/components/MobileMoreSheet.tsx` e `src/routes/app_.mais.tsx` (como Idioma e Aparência, que já estão em Ajustes).
- Manter apenas o essencial: Atalhos principais e acesso ao Hub de Ajustes.

### 4. Renomeações e Ajustes Visuais
- Renomear grupo "Insights" para "Análises e Relatórios" via i18n (`src/i18n/locales/pt/nav.json`).
- Corrigir a posição do `MobileNotificationsFab` para não sobrepor botões em formulários.

## Detalhes Técnicos

- **Redirects**: Implementar `beforeLoad` com `throw redirect` em `src/routes/app_.perfil.tsx`.
- **Lógica de Filtro**: Injetar `profile.tipo_cadastro` na chamada de `filterVisibleGroups` no `DesktopSidebar` e `MobileMoreSheet`.
- **CSS/Layout**: Ajustar o `z-index` ou o `bottom` do FAB de notificações em páginas de formulário.

## Verificação
- Validar se um usuário PF não vê o menu "Empresa".
- Validar se ao clicar em "Meu perfil" no mobile, o usuário cai em `/conta`.
- Validar se o FAB de notificações não obstrui o botão de salvar no formulário de gastos.
