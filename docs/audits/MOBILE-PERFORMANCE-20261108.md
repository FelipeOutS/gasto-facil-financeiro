# Desempenho mobile — 08/11/2026

Relato: Galaxy A11 lento ao navegar, rolar e tocar. Análise local, sem conta ou banco real. Branch `codex/mobile-performance-20261108`, baseada em `origin/main` e30d6dc8. O checkout original com alterações pendentes foi preservado.

## Artefato e limites

AAB analisado: `C:/Users/Felip/AndroidStudioProjects/GastoInteligente/app/release/app-release.aab`, 9.273.757 bytes, SHA-256 `1E25604231620DDF502A4EED5C5B149DC4DEC26E54F2960FC7A7AA1E4FAA133E`. O código Android aponta para o site publicado; as correções desta etapa são web, não alteram o AAB.

Não há telefone conectado para profiling. Nenhuma medição abaixo representa FPS, latência de toque ou ganho percentual no A11. Não foi possível atribuir toda a lentidão a uma causa única.

## Correções confirmadas no código

- `use-nav-scroll-size.ts`: o caminho de scroll não consulta mais diálogos ou altura do documento por quadro. Acumula direção e agenda a avaliação após 120 ms sem scroll, cancelando tarefas anteriores. A largura continua animada, mas inicia após essa pausa; não escreve `data-compact` se o valor não mudou. Cleanup cancela timer/frame. Posição, blur, temas, destinos e alvos de toque preservados.
- `GastosExportDialog.tsx`: não prepara linhas de exportação/recorrências enquanto fechado. Ao abrir e reabrir usa as props atuais. Formatos e lógica de exportação preservados.
- `format.ts`: reutiliza dois formatadores Intl de configuração fixa pt-BR/BRL. Evita construção repetida em listas e a cada frame dos saldos animados. Não muda cálculos, arredondamento ou tratamento anterior de zero/NaN.
- `use-liquid-nav-indicator.ts`: evita medir o indicador quando a seleção não mudou, inclusive na montagem inicial.

## Evidência isolada

Fixture dos componentes reais, sem sessão/backend, Chromium desktop, 60 quadros de scroll:

| Trabalho do menu | Antes | Depois |
| --- | ---: | ---: |
| Busca por diálogos | 60 | 1 |
| Gravações de data-compact | 30 | 1 |

Microbenchmark Node, 10.000 formatações BRL, três execuções: construir Intl a cada chamada 337–357 ms; reutilizar 4,9–5,6 ms. Mede apenas essa operação no computador, não desempenho geral do app.

## Validações

- 62 testes de navegação, overlays, exportação e equivalência de moeda aprovados.
- 35 testes FIN-01 e parcelamento aprovados.
- Script de scroll: direção, histerese, área mínima de toque, âncora inferior e movimento reduzido aprovados em 320/390/480 px.
- Script de performance: garante no máximo duas buscas e uma gravação após scroll contínuo.
- Typecheck e build finais aprovados (exit 0). Build mantém avisos preexistentes de inputValidator obsoleto, chunks grandes e configuração do bundler; não foram suprimidos.

## Outros candidatos — ainda não comprovados no aparelho

- Blur sobreposto de 18 px e 12 px: pode custar GPU no A11. Mantido para preservar o design solicitado; decidir redução somente com comparação visual e profiling no aparelho.
- A lista de Gastos usa motion/layout por linha; listas extensas podem exigir medição específica antes de virtualizar ou remover efeitos.
- Resposta inicial não autenticada de `/app`: quatro amostras anteriores entre 0,31 e 3,58 s até primeiro byte. Mistura rede/servidor e não mede navegação autenticada.
- CookieManager.flush no Android e R8 desabilitado são pontos para profiling, não evidência de causa. Nenhuma mudança de persistência de sessão ou assinatura foi feita.
- Preload global viewport pode competir por recursos, enquanto o BottomNav usa intent. Não ampliamos preload indiscriminadamente em um aparelho limitado, nem alteramos guards/cache de autorização.

## Homologação necessária

Depois de revisão e publicação autorizada da parte web: no mesmo A11 e na mesma rede comparar abertura de Gastos, alternância Início/Gastos/Cartões, rolagem longa nos dois temas, abertura do botão +, teclado, exportação e retorno. Medir frames/long tasks via Chrome remote debugging em pacote depurável isolado, sem capturar conteúdo financeiro. Conferir movimento do menu após pausa, blur inferior e navegação Android. O AAB atual e a produção permanecem inalterados nesta etapa.
