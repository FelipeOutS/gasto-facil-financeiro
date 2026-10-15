# Pacote visual preservando o Lovable

## Base e preservação

Branch local `codex/app-visual-release-20261014`, criada diretamente de `origin/main` em **b797eebb98a04155fd65809c2042d3afa5babe31** após fetch e atualizada por rebase sem conflitos para **cf903aa00ae7c64d4adf93471fbea76328d6c82c** antes do envio. Não é cópia integral do checkout antigo. Checkout `release-consolidation-20261014`, demais alterações locais e branch do PR #15 preservados.

O remoto avançou desde 1edcbb2a, incluindo exclusão/restauração mensal de WhatsApp, testes SQL e correção de vínculos no cadastro de cartões. Todas essas mudanças permanecem na base. `git diff origin/main -- src/server supabase AGENTS.md package.json bun.lock` retornou vazio. Nenhuma migration local pendente foi copiada. Isso comprova preservação do código enviado ao GitHub nessa referência; não comprova mudanças ainda não sincronizadas do editor Lovable nem qual versão está publicada no domínio.

## Incluído para revisão

- BottomNav com curva central e botão verde +, ações Despesa/Receita, abas Início/Gastos/Cartões/Cofre. Implementação de animação existente preservada.
- Cabeçalho: foto à esquerda para conta, logo maior centralizado, menu à direita.
- Dashboard personalizável: mostrar/ocultar e ordenar seis blocos, cancelar/restaurar padrão. Preferência por conta neste navegador/aparelho, sem sincronização com banco.
- Redução das repetições de resumo, mês e ações no mobile; desktop conserva os indicadores.
- Ajustes de insets de painéis, diálogos, navegação e aviso offline já preparados localmente. Não equivalem à correção da sobreposição do formulário OFFLINE embarcado rolado, que é separada no APK.
- Testes e fixtures isoladas de navegação/personalização. Nenhuma fixture publicada como tela real.

Arquivos de produção: BottomNav, DesktopSidebar, MobileQuickActionsSheet, MobileShell, MobileTopBar; ui/alert-dialog, dialog, drawer, sheet; locales pt/en/nav; routes/__root, app, app_.mais; styles.css; dashboard/PersonalizedDashboard e lib/dashboard-layout.

## Fora deste pacote

Todas as mudanças locais de WhatsApp, RPCs/migrations, exclusão de conta, persistência financeira, importação, Cofre/PIN/biometria e código Android/offline. Nada foi removido dos outros checkouts. Nenhuma pasta de ferramentas ou arquivo de credenciais foi copiado; node_modules é somente junction local ignorada.

## Validação

- 69 testes aprovados, zero falhas/skips: mobile-navigation 35, dashboard-layout 7, dashboard-personalization 2, overlay-lifecycle 9 e whatsapp-cartoes-faturas-p1-2026-10-15 16. Arquivos executados em processos separados.
- Fixture em navegador real automatizado: 375, 430, 768, 1024, 1366, 1440 e 1920px; ordenar/ocultar, persistência, restauração, light/dark e fechamento passaram. Não substitui revisão do app autenticado ou aparelho físico.
- Typecheck e build: aprovados, exit 0. Build local gerou cliente/servidor; não publicou. Avisos do bundler sobre dependências/imports, chunks e opção platform permanecem; não indicam aprovação global para produção.
- routeTree.gen.ts foi regenerado reordenando o conteúdo: 3.239 linhas não vazias normalizadas em cada versão, nenhuma linha diferente no confronto ordenado. Como nenhuma rota foi criada/removida, mantida a versão original da main neste pacote; sem diff do arquivo gerado.
- Diff check: sem erros. Backend e migrations idênticos à base.

## Antes de tornar oficial

1. Revisar este pacote, sem misturar o trabalho pendente dos demais checkouts.
2. Commit/push/PR autorizados pelo usuário em 14/10. Merge e publicação continuam como etapas posteriores.
3. Atualizar a comparação com main imediatamente antes do merge, pois o usuário continua trabalhando no Lovable. Resolver eventuais conflitos por integração, nunca substituir o projeto por um checkout antigo.
4. Conferir o conteúdo do PR e os checks. Não aplicar migrations como parte deste pacote visual.
5. Após merge autorizado, verificar sincronização no Lovable e publicar com autorização. Código no GitHub não prova publicação no site.
6. Conferir domínio publicado e app principal: nova barra, menu, personalização, animação, light/dark, navegação e sessão. Esses componentes web não exigem novo APK por si só; o offline embarcado e outras mudanças nativas exigem distribuição do APK/AAB correspondente.

O pacote visual não representa aprovação global do aplicativo para Google Play. Persistem pendências de segurança/banco e validações já documentadas nos outros checkouts.
