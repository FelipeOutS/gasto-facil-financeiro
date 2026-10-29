# WhatsApp Showcase V2 — 28/10/2026

## Entrega local

Branch: `codex/whatsapp-showcase-v2-20261028`, criada sobre `c39d9faed7fddbfeb7c4b03d148df3f73344a054` (capturas mobile reais). Sem push, merge ou publicação. A referência local `codex/whatsapp-finalizacao-20261025` permanece em `258359faf9fb1be9fa92a42e79e0ac708ca472fa`; PR #27 não foi acessado nem alterado.

Alternativa A: React + CSS, componente isolado `WhatsAppShowcase.tsx`. A finalidade do movimento é explicar um fluxo ocasional de marketing. A alternativa B exigiria mídia, versões de idioma e controles de vídeo para representar os mesmos estados; não oferece vantagem aqui. Nenhuma dependência ou lockfile alterado, nenhuma mídia de vídeo incorporada ao produto.

## Implementação anterior e revisão visual

`WhatsAppFeatureSection` em `PublicLanding.tsx` tinha quatro balões estáticos, uma confirmação decorativa, cabeçalho com status online e campo sem interação. Usava Tailwind, Reveal e Framer Motion já instalados. A coluna direita mantém texto, benefícios, CTA `/whatsapp` e elegibilidade dos planos reais. O novo componente substitui somente o mockup. Os textos novos têm versões PT/EN.

| Antes | Depois | Motivo |
| --- | --- | --- |
| Conversa inteira estática | Narrativa determinística de 13 segundos | Explicar mensagem → conferência → confirmação |
| Frame branco, ícone genérico e status online | Frame verde escuro, BrandMark oficial e “Conversa demonstrativa” | Identidade consistente e transparência |
| Confirmação pouco destacada | Valor com hierarquia, metadados e feedback discreto de confirmação | Facilitar leitura e compreensão |
| Sem controles | Pausar/reproduzir e reiniciar, com teclado e alvos de 44 px | Dar controle ao visitante |
| Conteúdo potencialmente animado para todos | Cena final estática com movimento reduzido | Compreensão sem movimento |
| Promessa “em segundos” | “para você conferir” | Não prometer latência de produção |

O código real de confirmação foi consultado em `src/server/whatsapp.server.ts`: Confirmar/Ajustar/Cancelar. Nenhum arquivo de backend foi modificado. Os controles dentro da conversa são representação visual (não botões reais); somente os controles de reprodução são interativos. O campo é ilustrativo, não um input. Não se transmite mensagem, não se confirma uma operação financeira e não se afirma sucesso real do backend.

## Roteiro e arquitetura

- 0–0,7 s: introdução.
- 0,7–2,3 s: digitação progressiva.
- 2,3–3 s: envio visual.
- 3–4,2 s: indicação de análise.
- 4,2–6,5 s: Uber, R$ 35,00, Transporte, Hoje; conferência.
- 6,5–7,8 s: confirmação simulada, destaque e toque de 150 ms.
- 7,8–12,5 s: conclusão; 4,7 segundos para leitura.
- 12,5–13 s: saída com fade de 250 ms, retorno à introdução.

Um único intervalo de 50 ms controla o tempo; não há timers independentes por balão. Cleanup no desmonte, pausa e mudança de visibilidade. Delta limitado após suspensão evita saltar cenas. IntersectionObserver inicia/pausa sem reiniciar o ciclo ao oscilar o scroll; `visibilitychange` pausa em segundo plano. Pausa manual persiste fora da viewport. Reiniciar retorna a zero e respeita a pausa manual.

Entradas usam opacity e translateY de 8 px por 250 ms com o token --ease-out. Layout fixo da conversa reserva espaço para todas as mensagens. Os pontos só animam durante processamento; todas as animações pausam fora de reprodução. Nenhum áudio, bounce, confete ou zoom de conteúdo.

Foi mantido somente o gasto: um segundo cenário de receita alongaria a narrativa. O microcartão do aplicativo foi omitido para evitar redundância e uma representação inventada. A coluna direita permanece estável, sem destaques que disputem a leitura.

Acessibilidade: descrição completa estática para leitor de tela; conversa visual aria-hidden; nenhum live region repetindo mensagens; controles nativos com nomes acessíveis, foco visível, Enter e estado de pausa. Com prefers-reduced-motion, cena final imediata e controles de movimento desabilitados. Nenhum foco automático.

## Validação executada

- `npm run typecheck`: aprovado, exit 0.
- `npm run build`: aprovado, exit 0. Avisos preexistentes do TanStack createServerFn().inputValidator e build não foram alterados nesta tarefa.
- `node scripts/test-whatsapp-showcase.mjs <pasta-evidencias>`: aprovado em Chrome real nos viewports 390×844, 768×1024, 1440×900 e 1920×1080.
- Oito fases e pelo menos dois ciclos completos no desktop. Nos demais tamanhos, ciclo até a conclusão e controles.
- Pausar, reproduzir, reiniciar enquanto pausado, teclado, saída/entrada de viewport e mudança dinâmica para movimento reduzido: aprovados.
- Altura estável de ~693 px mobile e ~695 px desktop para celular + controles + legenda; variação inferior a 1 px. Sem overflow horizontal, mensagens sobrepostas ou conteúdo fora dos 430 px da conversa.
- Zero erros de página nos testes. Zero requisições de mutação financeira. O teste bloqueou e contabilizou separadamente dois relatórios CSP preexistentes da página por viewport, sem enviá-los.
- `scripts/test-landing-refinement.mjs`: regressão aprovada nas quatro resoluções (abas, planos, FAQ, movimento reduzido e estabilidade).
- Inglês em 390×844 com movimento reduzido: cena final, controles desabilitados, textos traduzidos e geometria conferidos.
- Gravação limpa de dois ciclos realizada. Revisão por sequência de frames a cada 0,5 s: ordem, permanência para leitura, reinício, estabilidade e ausência de cortes conferidos. Uma primeira gravação de teste tinha interferência da captura de elemento; a gravação final foi refeita sem screenshots durante a reprodução.

Limitações honestas: Chrome automatizado manteve document.visibilityState="visible" mesmo após abrir e trazer outra aba à frente. A troca foi tentada; o teste da reação ao evento visibilitychange foi então feito por simulação controlada da propriedade document.hidden, restaurada em seguida. Isso valida o handler, não comprova o evento nativo de segundo plano em navegador comum. A confirmação manual dessa troca de aba, Safari, leitor de tela e celular físico ainda é recomendada. Emulação de viewport não é homologação em hardware.

## Evidências

Pasta local: `E:/Projetos/APLICATIVO GASTO INTELIGENTE/evidencias/whatsapp-showcase-v2-20261028/`

- `before.png`: versão anterior.
- `after-390.png`, `after-768.png`, `after-1440.png`, `after-1920.png`: versão nova.
- `phone-390.png`: mockup completo no celular.
- `english-mobile.png`: versão inglesa estática.
- `demonstracao-dois-ciclos.webm`: gravação final, sem áudio.
- `revisao-gravacao.jpg`: sequência de frames revisada.
- `results.json`, `regression/results.json`, `typecheck.log`, `build.log`: resultados reais.

## Escopo dos arquivos

1. `src/components/landing/WhatsAppShowcase.tsx` — timeline, apresentação e controles.
2. `src/components/landing/WhatsAppShowcase.css` — frame, estados, layout e movimento.
3. `src/components/landing/PublicLanding.tsx` — substituição do mockup.
4. `src/i18n/locales/pt/landing.json` — textos PT.
5. `src/i18n/locales/en/landing.json` — textos EN.
6. `scripts/test-whatsapp-showcase.mjs` — verificações reproduzíveis de navegador.
7. Este relatório.

As alterações sujas de F2/WhatsApp, módulos app-v2 e rotas que já estavam no checkout foram preservadas e não entram neste commit. Nenhuma alteração em planos/preços, autenticação, banco, RPCs, webhook, Pluggy, Mercado Pago ou dados reais.

Não consigo confirmar consumo real de créditos ou tokens.
