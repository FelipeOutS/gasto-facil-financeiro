# Landing — jornada, FAQ e CTA final — 28/10/2026

Branch local: `codex/landing-jornada-faq-cta-20261028`, baseada em `0f523965b0c42274d225d7dd9f3ed78cb8a6e561`.

## Diagnóstico e decisão antes da implementação

A inspeção foi feita no localhost, com capturas anteriores em 1440 e 390 px, antes de modificar os componentes. O produto e o cadastro foram consultados no código. Foram utilizadas as orientações das skills emil-design-eng, animate e mobile-native. Não houve pesquisa de layouts externos nem novas dependências.

| Seção | Estratégia avaliada A | Estratégia avaliada B | Escolha e justificativa |
| --- | --- | --- | --- |
| Como funciona | Jornada linear, com progressão conectada e leitura completa | Etapas interativas com telas alternadas | A. A landing já tem abas de recursos, uma demo WhatsApp e telas mobile reais imediatamente antes. Mais um componente com alternância esconderia informação básica e repetiria a interação. A jornada estática explica os três momentos sem exigir cliques. |
| FAQ | Categorias por assunto e accordion único por categoria | Busca local com lista completa ou “ver mais” | A. Doze perguntas não justificam busca e estados de resultado vazio. Quatro assuntos tornam a seleção previsível; todas as respostas continuam disponíveis. Não foi adotado “ver mais”, que esconderia perguntas sem explicar a organização. |
| CTA final | Composição verde, próximo passo explícito e recorte real do produto | Encerramento apenas tipográfico com ilustração abstrata | A no desktop/tablet; versão focada em texto e ações no celular. A imagem real aproxima a oferta do produto. No mobile, não repetir a captura já mostrada na seção de demonstrações mantém o encerramento curto. |

## Revisão visual

| Antes | Depois | Por quê |
| --- | --- | --- |
| Três cards semelhantes, números duplicados, cores azul/verde/roxo | Jornada aberta, linha de continuidade, numeração única e verde da marca | Reduzir ornamentação e reforçar sequência |
| “Poucos segundos”, “menos de 5 minutos”, “resultado já no primeiro mês” | Início pelos registros do usuário, sem prazo nem resultado garantido | Eliminar promessas não comprovadas |
| FAQ de 12 linhas com coluna esquerda quase vazia | Cabeçalho central, quatro assuntos e suporte integrado abaixo | Aproveitar largura e reduzir o comprimento inicial |
| Espaço reservado fixo no FAQ | Altura medida, ajustada ao conteúdo | Evitar vazios em categorias curtas |
| Dashboard inventado no CTA com +12% e elementos flutuantes | Recorte da captura real do dashboard com dados sintéticos, identificado como demonstração | Apresentar o produto sem sugerir rentabilidade ou resultado prometido |
| Botões com pesos parecidos e cadastro pouco explicado | Cadastro em verde claro; planos como ação secundária; explicação do destino | Dar uma próxima ação clara |

## Componentes e preservação

`LandingClosingSections.tsx` reúne `HowItWorks`, `FAQ` e `FinalCTA`. `PublicLanding.tsx` apenas os importa e mantém a navegação de âncoras já existente. O Footer público continua exportado para LegalLayout.

A jornada adapta a linha horizontal para vertical no celular. Não tem loop, autoplay, hover decorativo nos passos ou necessidade de interação para leitura.

O FAQ usa Radix Tabs e Accordion existentes. Grupos:
- Primeiros passos: perguntas 0, 1, 11.
- Suas finanças: 2, 3, 4, 8.
- Acesso e uso: 9, 10.
- MEI e empresa: 5, 6, 7.

As 12 perguntas e respostas originais foram preservadas integralmente nas duas traduções. Uma resposta aberta por categoria, com estado conservado ao trocar de assunto. Sem busca desnecessária. O link de contato mantém `mailto:contato@gastointeligente.com.br`, sem prometer prazo de atendimento.

A captura do CTA reutiliza `public/images/landing/mobile/gasto-inteligente-mobile-dashboard.webp`, criada anteriormente a partir do componente real em ambiente isolado. O enquadramento CSS mostra o resumo mensal; nenhum pixel, número ou funcionalidade foi inventado. Alt e legenda explicam recorte real e dados demonstrativos. A imagem não é exibida abaixo de 768 px, priorizando leitura e ação e evitando duplicar a seção mobile.

CTA principal `/cadastro`, secundário `#planos`. Cadastro consultado no código e navegação conferida sem preencher ou enviar formulário. Planos, preços e condições existentes não foram modificados.

## Interações e acessibilidade

- Accordion com altura animada em 220 ms; linhas seguintes acompanham a abertura/fechamento, sem saltar para o destino.
- ResizeObserver mede o conteúdo; durante a animação do accordion, o wrapper acompanha sem introduzir uma segunda animação atrasada. Troca de categoria ajusta o wrapper em 220 ms.
- Teclado e prefers-reduced-motion desativam o movimento; sem foco automático.
- Radix fornece papéis, aria-controls/expanded/selected e navegação por setas/Home/End.
- Foco visível, alvos de ao menos 44 px, hover condicionado a ponteiro fino.
- Sem loops decorativos ou scroll-jacking.
- Paleta contínua: jornada branca, FAQ verde suave, CTA verde escuro; tipografia e ritmo compartilhados.

## Testes e resultados

`npm run typecheck`: aprovado. `npm run build`: aprovado. Permanecem os avisos de depreciação TanStack já presentes no projeto; não houve alteração de dependências.

`node scripts/test-landing-closing.mjs <pasta-de-evidencias>`:
- 390×844, 768×1024, 1440×900 e 1920×1080 aprovados.
- Todas as 12 perguntas e suas respostas conferidas contra o JSON original, em cada resolução.
- Categorias, Home/setas, Enter, foco e aria-expanded testados.
- Movimento reduzido e ausência de animações CSS em execução conferidos.
- Altura do wrapper igual ao conteúdo após transição; sem corte de respostas.
- Sem overflow horizontal, sem erros de página no fluxo português.
- Cadastro abriu `/cadastro`; “Ver planos” chegou ao destino correto; suporte preservado.
- Nenhuma operação financeira ou envio de formulário. O teste bloqueia requisições de escrita.

Teste adicional de movimento: oito posições intermediárias distintas da linha seguinte durante o fechamento, confirmando progressão real, não apenas compilação da animação. Evidência: `accordion-motion.json`.

`test-landing-refinement.mjs`: regressão da landing aprovada nos quatro tamanhos. A única adaptação foi o seletor do accordion do FAQ, que mudou de componente.

Inglês pelo seletor existente: categorias e CTA no viewport mobile aprovados, sem erros de página e sem overflow.

### Dimensões observadas (px, arredondadas)

| Seção / viewport | Antes | Depois |
| --- | ---: | ---: |
| Como funciona / 1440 | 782 | 648 |
| FAQ inicial / 1440 | 942 | 650 |
| CTA / 1440 | 587 | 625 |
| Como funciona / 390 | 1298 | 924 |
| FAQ inicial / 390 | 1161 | 788 |
| CTA / 390 | 527 | 565 |

O CTA ficou ligeiramente mais alto para explicar o cadastro e apresentar uma prévia fiel. Não foi alegado ganho medido de conversão: não houve experimento com usuários ou analytics.

## Evidências antes/depois

Diretório: `E:/Projetos/APLICATIVO GASTO INTELIGENTE/evidencias/landing-jornada-20261028/`

- `before-{how,faq,cta}-{1440,390}.png`: originais.
- `after-{how,faq,cta}-{390,768,1440,1920}.png`: resultado final.
- `navegador-final.png`: FAQ aberto na aba do usuário.
- `english-cta-mobile.png`: inglês via seletor.
- `results.json`, `accordion-motion.json`, `regression/results.json`, `typecheck.log`, `build.log`.

As capturas de elementos altos podem conter uma faixa da navegação fixa, decorrente do screenshot do navegador. O layout também foi conferido na viewport normal.

## Pendências e limites

- O acesso direto a `/?lang=en` apresentou divergência SSR/hidratação no texto do cabeçalho (Início/Home), fora dos três componentes. A configuração global de idioma e o cabeçalho não foram alterados. A troca pelo seletor funciona. Esse caminho direto deve ser tratado numa correção específica de internacionalização antes de divulgar links profundos em inglês.
- Testes responsivos usam Chrome real com viewports configurados. Celular físico, Safari e leitura por leitor de tela não foram homologados nesta etapa.
- A revisão não altera nem valida novamente funções financeiras ou disponibilidade de integrações.

## Arquivos desta entrega

- `src/components/landing/LandingClosingSections.tsx`
- `src/components/landing/LandingClosingSections.css`
- `src/components/landing/PublicLanding.tsx`
- `src/i18n/locales/pt/landing.json`
- `src/i18n/locales/en/landing.json`
- `scripts/test-landing-closing.mjs`
- `scripts/test-landing-refinement.mjs`
- Este relatório.

Alterações anteriores de F2, WhatsApp, app-v2 e rotas no checkout foram preservadas e não entram no commit desta etapa. Não houve push, merge, alteração no PR #27, publicação, mudança de banco, backend, autenticação ou preços. A demo WhatsApp e suas traduções permaneceram intactas.

Não consigo confirmar o consumo real de créditos ou tokens.
