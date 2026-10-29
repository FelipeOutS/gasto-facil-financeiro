# CTA final — direção editorial — 28/10/2026

Branch local: `codex/landing-jornada-faq-cta-20261028`. Base desta revisão: `b501772d7c6e1f3bc0dfc0395a7160ffc1211097`.

## Diagnóstico

O fundo verde contínuo ocupava mais espaço que a informação justificava. A captura cercada por uma segunda moldura, cabeçalho, legenda e sombra parecia um card promocional. O problema era de composição, embora a origem da captura fosse verdadeira. O título de três linhas, o texto, a explicação do botão e três condições comerciais disputavam atenção. Repetir a interface depois da seção mobile diluía o encerramento.

## Três abordagens consideradas

| Abordagem | Vantagem | Limitação | Decisão |
| --- | --- | --- | --- |
| Contêiner escuro compacto | Destaca a conversão sem pintar toda a largura | Ainda repete o recurso de card sobre fundo claro e mantém peso cromático no fim | Descartada |
| Captura real em composição aberta | Evidência concreta do produto sem mockup fictício | Repete a demonstração existente, exige legenda e aumenta a seção | Descartada para este ponto da página |
| Encerramento editorial neutro | Dá protagonismo ao texto e cadastro; encerra com menos ruído | Depende da precisão de tipografia e alinhamento, sem imagem para preencher | Escolhida |

A decisão considera o contexto completo: fotografias em planejamento e rotina, demonstração WhatsApp, capturas reais no bloco mobile, planos, FAQ e footer. A prova visual do produto já existe antes do CTA. Aqui, a informação necessária é valor e próximo passo. Não foram adicionadas imagens ou fontes.

## Alternativas de headline

| Alternativa | Avaliação |
| --- | --- |
| Veja para onde seu dinheiro vai. | Escolhida: curta, compreensível, ligada ao acompanhamento de gastos, boa divisão em duas linhas |
| O que entra. O que sai. Tudo no seu radar. | Personalidade próxima do app, mas três fragmentos e mais extensão |
| Seu mês financeiro, sem juntar as peças. | Liga organização e visão mensal, porém depende de metáfora |
| Comece pelos registros. Entenda o seu mês. | Explica o processo, mas soa mais instrucional que convite |
| Gastos e receitas no mesmo lugar. | Concreta, mas repete a descrição e reduz o produto a dois módulos |
| Veja seu mês. Planeje o próximo. | Boa leitura, mas sugere uma sequência de planejamento mais específica |

Texto final: “Veja para onde / seu dinheiro vai.” Descrição: “Gastos, receitas e planejamento no Gasto Inteligente. Comece com seus registros e acompanhe o mês em um só lugar.” CTAs preservados: “Criar minha conta” e “Ver planos”. Tradução inglesa correspondente atualizada.

## Revisão visual

| Before | After | Why |
| --- | --- | --- |
| Fundo verde escuro de largura total | Fundo neutro #fafbf9 e pequeno traço verde | A identidade aparece no destaque, sem dominar a área |
| Captura dentro de card com sombra e legenda | Sem imagem no encerramento | Evitar repetição e aparência de mockup |
| Headline genérica e extensa | Mensagem concreta, azul #172c38 e verde #217554 | Relação direta com a proposta de acompanhamento financeiro |
| Checklist e explicação do botão | Um parágrafo e dois destinos | Menos competição com o cadastro |
| Duas colunas fixas para copy e produto | Título acima, descrição e ações abaixo; empilhamento no tablet | Melhor proporção e fluxo de leitura |
| Botão verde-claro retangular | Botão azul arredondado, consistente com os CTAs existentes | Destino primário reconhecível na landing |

Manrope existente, peso 650, tamanho máximo 64 px no desktop e 40 px no mobile. Sem gradientes, glow, cards flutuantes, loop ou entrada animada. Apenas hover de cor e feedback de pressão; redução de movimento desliga a transição. Foco visível e alvos de pelo menos 48 px. As cores de texto sobre fundo neutro mantêm contraste superior ao mínimo de texto normal (a headline também é texto grande).

## Origem da imagem anterior

Foi conferido o manifesto `docs/audits/MOBILE-CAPTURAS-20261028.json` e o hash do arquivo público `public/images/landing/mobile/gasto-inteligente-mobile-dashboard.webp`:

`b1933fceaad4798a9b177f71a7a9d8aebd2e526c1ed5f9e290b8b6cd1a1cee1a`

Corresponde à captura web responsiva da rota real /app em fixture isolada com provedores sintéticos, documentada em `docs/audits/MOBILE-CAPTURAS-20261028.md`. Não é uma captura Android. Nenhum dado real foi acessado nesta revisão. O CTA final não usa imagem; a demonstração anterior do produto continua disponível.

## Validação real

- `npm run typecheck`: aprovado.
- `npm run build`: aprovado; avisos existentes de depreciação TanStack inputValidator permanecem fora do escopo.
- `node scripts/test-landing-final-cta.mjs before <evidencias>`: capturas antes nos quatro tamanhos.
- `node scripts/test-landing-final-cta.mjs after <evidencias>`: aprovado nos quatro tamanhos; headline, ausência de mockup, overflow, destinos, navegação real até /cadastro, âncora de planos, foco por Tab/Shift+Tab, alvos de toque e reduced motion. Sem pageerror.
- `node scripts/test-landing-closing.mjs <evidencias>/regression`: aprovado nos quatro tamanhos, incluindo todas as 12 respostas do FAQ, abas, teclado e rotas.
- Conferência visual integrada no navegador aberto, capturas em desktop e mobile. Sem cortes ou overflow horizontal nos tamanhos solicitados.
- Requisições de escrita bloqueadas no navegador de teste. Cadastro apenas aberto, sem preenchimento/submissão.

Um primeiro teste de foco usando apenas focus() falhou porque a modalidade anterior era mouse, que corretamente não exige :focus-visible. O teste foi corrigido para navegar por Tab/Shift+Tab, e passou. Não foi necessário forçar outline para cliques de mouse.

| Viewport | Altura anterior | Altura final |
| --- | ---: | ---: |
| 390 × 844 | 564,69 px | 395,25 px |
| 768 × 1024 | 598,69 px | 456,56 px |
| 1440 × 900 | 624,94 px | 432,84 px |
| 1920 × 1080 | 624,94 px | 432,84 px |

Pasta de evidências: `E:/Projetos/APLICATIVO GASTO INTELIGENTE/evidencias/cta-editorial-20261028/`. Arquivos `before-cta-{largura}.png`, `after-cta-{largura}.png`, `before-context-{largura}.png`, `after-context-{largura}.png`, `navegador-final.png`, resultados JSON e logs. Capturas contextuais incluem os trechos adjacentes do FAQ/footer conforme a altura disponível. A versão mobile foi validada em viewport Chrome; interação em hardware físico/Safari permanece pendente. A divergência global de hidratação ao abrir diretamente ?lang=en, registrada na revisão anterior, não faz parte desta alteração.

## Arquivos desta etapa

- `src/components/landing/LandingClosingSections.tsx`: markup somente do FinalCTA.
- `src/components/landing/LandingClosingSections.css`: remove estilos antigos de mockup e composição verde; novo fechamento editorial.
- `src/i18n/locales/pt/landing.json`: somente closing.cta.
- `src/i18n/locales/en/landing.json`: somente closing.cta.
- `scripts/test-landing-final-cta.mjs`: verificação visual e funcional local.
- `docs/audits/CTA-EDITORIAL-20261028.md`: este relatório.

Sem alterações de dependências, preços, rotas de negócio, backend, WhatsApp, Pluggy, Supabase ou PR #27. Alterações preexistentes de app/F2 permanecem fora deste commit. Sem push, publicação ou merge. Consumo real de créditos/tokens indisponível para confirmação.
