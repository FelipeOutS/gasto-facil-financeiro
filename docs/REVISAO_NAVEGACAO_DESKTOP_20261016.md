# Revisão da navegação desktop — 16/10/2026

Base: gravação 230427 e capturas do usuário. Sem publicação em produção.

| Antes | Depois | Motivo |
| --- | --- | --- |
| Gestão abre Minha conta | Perfil permanece no nome/avatar; topo usa atalhos diretos | Evita duplicidade e rótulo abrangente para destino específico |
| Planejamento abre Cartões | Cartões e Metas têm atalhos próprios | O destino corresponde ao nome exibido |
| Relatórios pode abrir Alertas quando indisponível | Atalho oculto se Relatórios não estiver visível | Não substituir destino por outro módulo |
| Visão geral aparece ativa em /app/ajustes | Correspondência exata para /app | Evita duas seções ativas |
| Tema no topo e na lateral | Apenas botão ao lado do perfil | Remove controle duplicado |
| Ícones concentrados no alto | Barra centralizada na área lateral, com rolagem em alturas pequenas | Equilíbrio visual sem perder acessos |

## Observações da gravação
- Gastos, Receitas, Contas, Mercado, Metas, Guardado, Empresa e Relatórios abrem conteúdo correspondente aos itens laterais.
- Assinaturas, Investimentos e Fornecedores mostram mensagens de ausência de registros; espaço livre nesses casos não prova falha de carregamento.
- Bens e Pacote para Contador apresentam placeholders de carregamento em alguns frames. O pacote mostra conteúdo depois; não classificar o placeholder transitório como erro sem reprodução.
- Metas com apenas um item tem composição esparsa à esquerda; oportunidade de refinamento específica, não defeito de navegação. Não alterada neste patch.
- Vídeo é evidência visual, não validação de gravação, cálculos ou permissões de servidor.

## Validação
Quatro testes de destinos e permissões (23 asserções), ESLint dos três arquivos TypeScript alterados e compilação da fixture visual aprovados. Conferência final na prévia com conta conectada.
