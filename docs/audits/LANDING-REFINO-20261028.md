# Landing — refino local de 28/10/2026

Implementado na branch `codex/landing-refino-20261028`, criada a partir de `258359faf9fb1be9fa92a42e79e0ac708ca472fa`. Sem push, publicação, merge ou alteração de serviços financeiros.

## Diagnóstico e decisões

Código e gravação `Gravação de Tela 2026-10-28 203105.mp4` (62 s) inspecionados. A região de trocas/recolhimentos aparece aproximadamente entre 24 e 48 s. Causas confirmadas no código: troca imediata de `hidden` sem interpolar a altura; grandes seções dentro de `details`; rolagem por loop personalizado de 800 ms; conteúdo inicialmente transparente; layouts repetidos. Não atribuímos os saltos a backend ou autenticação.

| Antes | Depois | Por quê |
| --- | --- | --- |
| Abas mudavam altura imediatamente | Medição com ResizeObserver, altura e entrada em 240 ms; somente um painel visível | Preservar contexto sem sobreposição ou tela vazia |
| Demonstrações e bancos recolhidos em details | Seções visíveis; demos agrupadas em abas acessíveis | Remover colapso de grandes regiões |
| Scroll personalizado longo | Scroll nativo, compensação do cabeçalho, abertura da aba correspondente | Permitir interrupção e links diretos |
| Repetição de cards brancos | Fundos verde, creme e azul discretos; listas e composição editorial | Diferenciar conteúdos sem mudar a marca |
| Mercado/Importação com texto e blocos redundantes | Fotografia específica, quatro benefícios e CTA | Melhor leitura e proporção |
| MEI com múltiplos blocos decorativos | Benefícios numerados e imagem de empreendedora | Evidenciar necessidades empresariais |
| Demonstração de celular pequena/redundante | Mockup HTML, identificação ilustrativa, Cofre e Radar | Melhor legibilidade e menos repetição |
| Depoimentos/avaliações sem comprovação | Bloco removido | Não inventar prova social |
| Logos de bancos em grande seção | Grade compacta com aviso explícito de organização manual | Não sugerir parceria ou conexão automática |
| Filtros de planos decorativos | Todos/Pessoa Física/MEI/Empresa funcionais | Facilitar comparação preservando oferta |
| FAQ com mudanças abruptas | Radix, altura 220 ms; múltiplas respostas abertas | Teclado, estados acessíveis e contexto preservado |

A apresentação do WhatsApp descreve mensagem, conferência e confirmação, com mockup identificado como ilustrativo. Mantém a condição de plano elegível/vínculo/consentimento; não altera disponibilidade, flags ou integração. Nenhum recurso foi ativado. A disponibilidade operacional deve ser confirmada pelo responsável antes de publicar.

As funções `PlanCardItem` e `FreeAdsPlanCard` foram comparadas com o snapshot inicial e permaneceram idênticas. Não houve alteração no catálogo, preços, limites ou checkout. Recursos únicos das antigas seções continuam em finanças, planejamento, demonstrações, MEI e faixa de público; foram retiradas apresentações repetidas.

## Validação

- `npm run typecheck`: aprovado.
- `npm run build`: aprovado; avisos preexistentes de bundling permanecem.
- `node scripts/test-landing-refinement.mjs`: aprovado em Chrome, quatro resoluções.
- Abas: todos os painéis, Home/End/setas, cliques rápidos, medição de altura e apenas um painel visível.
- Mercado/Importação: 39–40 amostras por animação; nenhum painel vazio, scroll variando menos de 3 px.
- Movimento reduzido: nenhuma animação ativa no painel após alterar a preferência.
- Filtros: 5 planos em Todos, 2 Pessoa Física, 2 MEI, 1 Empresa.
- FAQ: abertura/fechamento por clique e Enter; nenhum details estrutural.
- Nenhum overflow horizontal ou erro JavaScript de página nas quatro resoluções.
- Âncoras importacao-inteligente, app-mobile e planos: visíveis, aproximadamente 85–100 px abaixo do topo com navbar fixa.
- IDs dos gradientes SVG tornados únicos com useId, evitando conflito entre mocks montados em abas diferentes.

| Viewport | Altura inicial local | Altura após refino |
| --- | ---: | ---: |
| 390 × 844 | 21022 px | 18064 px |
| 768 × 1024 | 17026 px | 13375 px |
| 1440 × 900 | 12004 px | 10635 px |
| 1920 × 1080 | 12004 px | 10635 px |

Alturas com abas iniciais/planos completos; mudam conforme conteúdo selecionado. Medição de scroll é teste de interação, não uma pontuação Lighthouse/CLS.

## Arquivos e evidências

Código: PublicLanding.tsx, LandingInteractions.tsx, landing-refinement.css, LifestylePhoto.tsx e lifestyle-photo.css; traduções pt/en; oito WebP locais já preparados para a landing; script de regressão. Nenhuma nova dependência ou lockfile alterado.

Evidências locais: `E:\Projetos\APLICATIVO GASTO INTELIGENTE\evidencias\landing-refino-20261028`.
- before-*-inicio/facilite-sua-rotina/planos.png
- after-{390,768,1440,1920}.png (páginas completas, imagens carregadas)
- after-*-inicio/facilite-sua-rotina/planos.png
- comparacao-mercado.png, video-contact.jpg, results.json, typecheck.log, build.log

As capturas de elemento podem conter a navbar fixa sobreposta pela técnica de screenshot; a página completa e a inspeção no navegador mostram a composição real.

Reprodução: iniciar `npm run dev -- --host 127.0.0.1 --port 3001`; rodar `node scripts/test-landing-refinement.mjs`. O script recusa hosts externos, usa Chrome instalado e não faz login nem envia formulários. LANDING_TEST_OUTPUT define pasta de evidências opcional.

## Limitações e preservação

Não houve teste em aparelho físico, Safari/iOS ou leitor de tela real. A validação foi em Chrome com viewports simulados, sem dados reais. A decisão editorial final e a disponibilidade comercial dos recursos precisam de revisão antes de qualquer publicação. Crédito/token real não disponível para confirmação.

O checkout já tinha alterações não commitadas de F2/WhatsApp e imagens internas. Elas foram preservadas fora do commit. O commit da landing não contém SQL, testes financeiros, rotas autenticadas, variáveis, backend, dependências ou alterações do PR #27.
