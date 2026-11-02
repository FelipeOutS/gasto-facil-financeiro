# Correção visual Finexy — 16/10/2026

Branch: `codex/finexy-fidelity-local`. Pacote autorizado para envio e integração pelo GitHub; publicação do site permanece separada. As observações abaixo registram a validação local anterior ao envio.

## Resultado e limites da entrega

A composição foi alterada no componente usado pela rota real `src/routes/app.tsx`, além do ambiente visual isolado. A rota real continua recebendo os mesmos `saldo`, `totalEntradas`, `total`, `totalGuardado`, `contasResumo`, `gastosConfirmados`, `receitas`, `cartoes`, `ultimos` e limites calculados anteriormente. Nenhuma consulta, autenticação, regra financeira, RLS, migração ou integração WhatsApp foi alterada.

A validação autenticada com os dados do titular **continua pendente**: o app em http://127.0.0.1:3000/app falha ao consultar a assinatura porque o ambiente local não tem a configuração de servidor necessária. Não foi criado bypass nem conectada uma chave de produção. Essa pendência impede declarar a integração validada de ponta a ponta.

http://127.0.0.1:3001/app é exclusivamente a prévia isolada, identificada como dados fictícios e sem banco. Usa os mesmos componentes de apresentação, mas rotas secundárias são destinos de teste. Seu estado vazio pode ser alternado na tela. Não representa uma conta real.

## Comparação inspecionada

Referência: segunda imagem fornecida, recortada apenas ao painel, retirando fundo decorativo. Captura do app com largura normalizada para comparação, preservando proporções; não é uma medição pixel a pixel.

| Antes | Depois | Motivo |
| --- | --- | --- |
| Sidebar textual de 256 px | Trilho de 64 px, botões de 44 px e popovers por grupo | Aproximar a navegação estreita e manter os módulos autorizados acessíveis |
| Resumo à esquerda e indicadores à direita, gráfico abaixo | Três regiões iguais: principal, grade 2×2, gráfico | Reproduzir a composição superior da Finexy |
| Ações separadas do saldo | Duas ações dentro do principal e três resumos na base | Reproduzir hierarquia e posições |
| Gráfico amplo de área | Barras de receitas/despesas no alto à direita | Igualar posição e proporção; cálculos reaproveitados |
| Tabela abaixo dos blocos | Tabela nas duas colunas inferiores direitas | Manter atividades próximas dos indicadores |
| Ausência de cartões no primeiro painel | Cartões cadastrados abaixo do orçamento | Usar os cartões existentes sem números completos ou CVV |
| Primeira apresentação escura | Sessão de teste em tema claro; escuro disponível | Comparação com a referência sem mudar a preferência da conta real |

A estrutura está próxima da referência; não é reprodução pixel a pixel. Diferenças intencionais: verde da marca, textos em português, resultados mensais em vez de saldo bancário consolidado, três resumos em vez de carteiras multimoeda e cartões sem dados sensíveis. A tabela mantém a lista de gastos recentes já fornecida pela página; não inventa status de pagamento ou ações sem implementação.

## Componentes corrigidos

- `DesktopSidebar.tsx`: trilho compacto, popovers com foco/Escape e permissões existentes; seletor de conta no grupo Conta.
- `DesktopTopBar.tsx`: marca à esquerda, cápsula central e perfil à direita.
- `MobileShell.tsx`: espaço desktop fixo para o trilho, sem modificar a barra inferior.
- `dashboard/DashboardOverview.tsx`: grade compartilhada e apresentação `DashboardCards`.
- `dashboard/DashboardFinancialCards.tsx`: busca e filtro de categoria, avatar, tabela e orçamento sem divisão por zero.
- `FluxoCaixaChart.tsx`: modo compacto opcional de barras; modo anterior mantido nos demais usos.
- `src/routes/app.tsx`: usa a nova composição com os dados existentes; mantém blocos complementares personalizáveis.
- `src/premium.css`: estilos limitados ao conteúdo e navegação desktop.
- Fixture em `tests/fixtures/premium-dashboard/entry.tsx`: monta os componentes reais com dados de teste explícitos.

Os arquivos `BottomNav.tsx`, `MobileQuickActionsSheet.tsx` e `src/styles.css` permanecem sem diff contra HEAD. Não foram substituídos ícones, dimensões, animações, ações ou estilos da navegação inferior. CSS novo não seleciona a barra inferior.

## Verificação

- 57 testes aprovados, 0 falhas, 0 skips: desktop-areas, dashboard-layout, dashboard-personalization, mobile-navigation e overlay-lifecycle.
- Typecheck aprovado após tratar limite ausente na rota.
- ESLint dos componentes/rota modificados aprovado com regra de formatação desativada; não equivale a lint global limpo. O repositório já apresentava muitas divergências de formatação na etapa anterior.
- Build final aprovado (exit 0), após a correção do orçamento vazio. Avisos de diretivas use client das dependências e opção platform do bundler não impediram a geração.
- Browser: 1440×900, 1920×1080 e 390×844; sem overflow horizontal do documento. Capturas integrais adicionais em 1440×1200 para incluir toda a composição.
- Inspeção em claro e escuro; abertura/fechamento do menu Financeiro; busca sem resultados e limpar; estado vazio de cartões/gráfico/movimentações/orçamento; botão + mobile e suas ações preservados.
- Bug encontrado no teste vazio: `NaN% usado` com limite zero. Corrigido e verificado como `Limite não configurado`.
- Android físico, teclado virtual e dados reais autenticados não foram validados nesta rodada. Nenhum APK novo foi gerado.

## Evidências locais

Pasta: `C:/Users/Felip/AppData/Local/Temp/gi-premium-evidence/`

- `finexy-light-full.jpg`: composição completa clara.
- `finexy-dark-full.jpg`: composição completa escura.
- `finexy-mobile-390.jpg`: mobile 390×844.
- `finexy-comparacao.png`: comparação lado a lado inspecionada.
- `finexy-light-1440.jpg`: viewport 1440×900.

Nada foi publicado. Não é possível confirmar o consumo real de créditos.

## Tipografia e mascote — complemento
- Manrope nos títulos; Inter no texto, navegação e valores, com números tabulares. Escopo restrito ao conteúdo premium, sem alterar BottomNav ou estilos globais.
- Artes originais: Porquinho Apresentador de Moletom Verde (orientação e cartões vazios) e Porquinho Analítico de Capuz Verde (movimentações vazias).
- Corrigida quebra de linha dos indicadores para os valores da prévia. Prévia passa a carregar as mesmas fontes da aplicação.
- Typecheck e lint dos três componentes aprovados. Inspeção visual em 1440 e 390 px.
- Login real local continua bloqueado por configuração de servidor: credencial antiga testada uma vez em endpoint somente leitura, HTTP 401; não aplicada. Nenhum segredo incluído no código.
- Conector Lovable confirmou projeto 5de62d63-2340-4175-8a16-26c2beff1e71 no commit ad3d906c, anterior a este pacote local. Ver o redesign com login próprio pelo Lovable depende da integração do pacote. Não houve push, publicação ou alteração de banco.

## Verificação antes da integração
57 testes aprovados. Suites DOM executadas em processos separados: a execução conjunta registra Happy DOM duas vezes. Build e typecheck aprovados na revisão de fontes e mascotes. Backend, autenticação, migrações, WhatsApp e BottomNav sem alterações neste pacote.

