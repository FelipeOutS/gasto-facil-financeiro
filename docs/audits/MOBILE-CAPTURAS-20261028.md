# Seção mobile com capturas reais — 28/10/2026

## Origem e fidelidade

As quatro imagens são screenshots de componentes React das rotas reais do aplicativo, executados em navegador Chrome a 390 × 844, escala 2 (arquivos 780 × 1688). Não são interfaces desenhadas para a landing. O frame externo é CSS; todo o interior vem da captura. Os PNG originais permanecem na pasta de evidências, fora do bundle.

O emulador emulator-5554 estava conectado, mas sem pacote Gasto Inteligente instalado. O checkout não contém um projeto Android; existem APKs anteriores em outras pastas, sem ambiente demonstrativo isolado preparado. Para evitar contato com produção ou uso de uma versão Android antiga, foi usada a alternativa web responsiva explicitamente autorizada. **Não são capturas Android nativas.** A legenda pública informa web responsiva e dados demonstrativos.

O entrypoint de captura importa diretamente `Route.options.component` das quatro rotas e registra os mesmos caminhos no TanStack Router. MobileShell, header, navegação inferior, cards, gráficos, formulários e traduções são os componentes existentes. Nenhum JSX das telas foi copiado/recriado. A produção não importa os arquivos da fixture.

Apenas os provedores de dados/sessão/plano são substituídos no bundle isolado de testes; as fontes da autenticação, permissões e banco não foram modificadas. Perfil Demonstração, bancos, metas, reservas, despesas, receitas e ativos são sintéticos. O adaptador Supabase não tem chave/URL de produção, recusa escritas; servidor de captura aplica `connect-src 'none'; form-action 'none'`. O navegador permite apenas localhost, fontes públicas e a imagem pública de capa de meta (Unsplash já usada pelo produto), bloqueando demais requisições. Nenhum login ou dado real foi utilizado.

| Aba | Rota/componente real | Arquivo público |
| --- | --- | --- |
| Mobile e app | /app — AppRoot/Index, MobileMonthSummary, MobileShell | gasto-inteligente-mobile-dashboard.webp |
| Metas | /metas — MetasPage/MetaCard | gasto-inteligente-mobile-metas.webp |
| Investimentos | /investimentos — InvestimentosGate/InvestimentosPage | gasto-inteligente-mobile-investimentos.webp |
| Guardado | /guardado — GuardadoPage | gasto-inteligente-mobile-guardado.webp |

Arquivos: `public/images/landing/mobile/`. Manifesto `MOBILE-CAPTURAS-20261028.json` registra SHA-256 de cada imagem e arquivo de rota usado, viewport, data e plataforma. As capturas representam o checkout local, incluindo alterações visuais preexistentes de app que continuam fora deste commit. Portanto, os hashes de fonte documentam o estado efetivamente capturado, não apenas o HEAD.

## Alteração visual e interação

| Antes | Depois | Motivo |
| --- | --- | --- |
| Celular HTML demonstrativo e diferentes composições para demais abas | Quatro screenshots reais em um frame CSS consistente | Fidelidade ao produto |
| Conteúdo variável e genérico | Título, descrição e três benefícios específicos por tela | Correspondência entre imagem e informação |
| Altura variável | Colunas sobrepostas no mesmo grid para medir a maior copy; inativas invisíveis, inert e aria-hidden | Altura estável sem leitores de tela duplicados |
| Troca simples | Decodificação prévia, saída 100 ms e entrada 180 ms, deslocamento 8 px | Evitar flash e imagem não carregada |

Uma única imagem é renderizada. As demais são preparadas por foco/hover ou seleção, sem baixar todas na carga inicial. Controle de geração invalida trocas antigas em cliques rápidos. Teclado tem setas/Home/End, roving tabindex e troca imediata. Reduced motion remove animação. Falha no carregamento preserva a tela anterior e informa erro. Alvos de toque de pelo menos 46 px, hover condicionado ao ponteiro, proporção preservada e imagem sem object-fit:cover.

PublicLanding muda somente o componente usado em `#demonstracoes`. `#app-mobile` permanece como âncora. Novos textos pt/en ficam em realMobile. Componentes financeiros, preços e regras permanecem intactos.

## Testes e evidências

- Typecheck e build aprovados.
- `scripts/test-landing-real-mobile.mjs`: quatro abas em 390×844, 768×1024, 1440×900 e 1920×1080; quatro src distintos, imagens decodificadas, um tabpanel acessível, nenhum overflow ou erro de página.
- Altura da seção permanece igual nas quatro abas em cada viewport: 1697 / 1117 / 1133 / 1133 px, respectivamente.
- Cliques rápidos terminam na última aba; scroll variando menos de 3 px; Home/End/setas e foco aprovados; reduced motion sem animação ativa.
- `scripts/test-landing-refinement.mjs`: regressão das outras abas, filtros de planos, FAQ, teclado e scroll aprovada nas quatro resoluções. A antiga verificação genérica de demonstracoes foi substituída pela suíte específica.
- Inspeção visual dos screenshots, antes/depois, desktop e celular; gravação local WebM gerada pelo Playwright.

Evidências: `E:\Projetos\APLICATIVO GASTO INTELIGENTE\evidencias\mobile-real-20261028` — before-desktop/mobile.png, after-{largura}-{aba}.png, quatro PNG originais, tests.json, manifest.json, typecheck.log, build.log, pasta video e regression.

## Reprodução isolada

1. `bun scripts/build-landing-real-mobile.ts <pasta-temporaria> --serve` (porta 3012, loopback).
2. `node scripts/capture-landing-real-mobile.mjs <pasta-evidencias>`.
3. Frontend: `npm run dev -- --host 127.0.0.1 --port 3001`.
4. `node scripts/test-landing-real-mobile.mjs <pasta-evidencias>` (Chrome instalado e Playwright ffmpeg para vídeo).

Os scripts de captura/fixtures não entram na aplicação publicada. Não foi adicionada dependência ou modificado lockfile. Bun e o binário de vídeo foram usados como ferramentas locais.

## Limitações

Não validado em celular físico, Android nativo, Safari/iOS ou leitor de tela físico. A captura de Investimentos usa o resumo superior: a listagem detalhada atual comprime informações e ações em largura mobile, problema observado fora do escopo da landing, não corrigido nem retocado na imagem. O topo real do dashboard contém uma mensagem de objetivos existente; não foi redesenhado para a captura. Valores demonstrativos e rendimentos não são promessa financeira.

Sem publicação, push, merge, banco real, flags ou mudanças no PR #27. Alterações anteriores de F2/WhatsApp e rotas internas seguem preservadas e fora deste commit. Créditos/tokens reais não disponíveis para confirmação.
