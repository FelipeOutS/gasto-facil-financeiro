# Validação local antes do Google Play — 31/10/2026

## Decisão
NÃO APTO PARA PUBLICAÇÃO ainda. Correção de cliques validada localmente; pendências comerciais, biométricas e de empacotamento abaixo impedem afirmar prontidão para a loja.

## Escopo e limites
Análise de código, suíte web, instrumentação Android no GastoValidacao Android 17 (páginas de 16 KB), unidade/lint/build release. Pacote de instrumentação isolado `.offlinevalidation`; dados sintéticos, sem salvar lançamentos reais. Nenhum push, merge, publicação, migração real, alteração de segredo ou mensagem Meta foi realizado nesta etapa. Alterações preexistentes foram preservadas.

## Correções
- Popups Select e outros overlays podiam ficar com altura zero na WebView, mesmo com innerHeight positivo: CSS vh/dvh retornava zero. Usado o `--app-viewport-height` já medido pelo aplicativo em 32 arquivos. Ver CLIQUES-ANDROID-20261031.md e evidence-clicks-20261031/changed-files.json.
- Teste de plano gratuito atualizado para a renderização por visiblePlans; continua exigindo que o card gratuito exista e preceda os pagos.
- Teste de áudio com dia futuro fixou a data em 12/10/2026 e restaura o relógio ao finalizar. Não alterado o parser financeiro.
- Teste Android de identidade compara BuildConfig.APPLICATION_ID, preservando o pacote isolado.
- Teste de área segura verifica os insets CSS fornecidos pela bridge e a posição do conteúdo. A WebView edge-to-edge não deve ser confundida com conteúdo sobreposto às barras. Fixture sintética consome a bridge como o site; não é prova de todas as telas publicadas.

## Resultados
| Verificação | Resultado |
|---|---|
| Suíte web completa, 293 arquivos, concorrência 2 | 4.251 aprovados, 0 falhas, 21 ignorados, 0 erros |
| Teste independente de planos (harness próprio) | 101 aprovados, 0 falhas; não incluídos no contador Bun acima |
| Typecheck e build web | Aprovados |
| Unidade Android | 40 aprovados, 0 falhas |
| lintRelease / assembleRelease | Aprovados; lint com 0 erros e 52 avisos, não é lint sem avisos |
| Instrumentação Android | 50 aprovados, 0 falhas, 7 ignorados por ausência de biometria forte cadastrada (57 casos totais); rodada completa final aprovada |
| Compatibilidade do site: área segura, teclado e localização | 3/3 aprovados no reteste |
| Selects na WebView, clique/toque | 6/6 aprovados na etapa anterior |
| Componentes de interação em navegador isolado | 8/8 aprovados na etapa anterior |

Logs em `evidence-preplay-20261031`. A primeira rodada web teve duas falhas de teste e um timeout; os logs originais foram preservados. Avisos Android incluem recursos/ícones, atualização de dependências/SDK e modernização Kotlin; nenhuma atualização ampla foi feita para escondê-los.

## Bloqueios e riscos restantes
1. **Cobrança de assinatura dentro do app**: `src/routes/meu-plano.tsx` oferece Pix/Mercado Pago para recursos digitais; não foi encontrada integração com Google Play Billing no código inspecionado. Definir Billing ou comprovar enquadramento/adesão a programa de cobrança alternativa aplicável antes de habilitar esse fluxo na distribuição Play. WebView não é uma dispensa. Não alterei a monetização.
2. **Biometria real**: testes dependentes de biometria forte cadastrada foram ignorados pelo emulador. É necessário testar ativar, sair, reabrir e desbloquear no celular, inclusive cancelamento, digital alterada, reinício e atualização do APK. Os testes de credencial do dispositivo e de rejeição de origem não equivalem a essa homologação.
3. **Exclusão de conta**: existe em Meu plano, via DeleteAccountDialog/deleteMyAccount. Não executada. A função atual registra erros e continua removendo tabelas antes de excluir Auth; uma falha parcial merece homologação isolada e estratégia recuperável. Não afirmar exclusão integral testada. Confirmar também URL externa de solicitação no Play Console e instruções claras; a página LGPD contém contato, mas sua aceitação/configuração na loja não foi verificada.
4. **Artefato da loja**: release local é APK não assinado, versão 1.0/code 1. Confirmar chave de assinatura/Play App Signing, versionCode disponível, gerar AAB de entrega e testar atualização preservando sessão/dados. Não criei nem alterei chaves.
5. **Hardware e cobertura**: somente um emulador Android 17 nesta rodada; não houve teste completo em Android 7 (minSdk24), aparelho físico, redes instáveis reais, câmera/comprovantes reais ou todas as combinações de conta/assinatura. Conferir botão Voltar com todos os tipos de modal, rotação, fontes ampliadas, TalkBack e teclado em formulários longos antes da liberação.
6. **Publicado versus local**: sucesso local não prova equivalência ao backend publicado nem aplica candidatas F2/F4. Manter ativação financeira bloqueada conforme plano de implantação anterior. Não repetir migrações ou habilitar funções para satisfazer testes.
7. **Estabilidade dos testes**: o teste de PIN excedeu 5 segundos na primeira execução concorrente, mas passou isolado e com concorrência 2 sem ampliar timeout. Há sensibilidade à carga; não ocultar a primeira falha.

## Verificações do APK local
- targetSdk 36, minSdk24; backup desabilitado; tráfego claro desabilitado no release; URL de release HTTPS; depuração WebView condicionada a DEBUG.
- zipalign `-c -P 16 4`: aprovado. Segmentos LOAD das quatro variantes de libandroidx.graphics.path.so alinhados a 16384.
- SHA-256 do APK unsigned validado (`assembleRelease` reutilizou a saída UP-TO-DATE): `4584b1cde989863cef9f1966f7d473910f54fa9c0f803551ff50bb0e5a98fbb3`.
- Alinhamento não equivale a aprovação Play nem a validação de todos os dispositivos.

## Ordem mínima para liberar
1. Resolver a estratégia de cobrança e validar exclusão de conta/URL externa e declarações de dados/permissões.
2. Testar o pacote isolado no celular com biometria cadastrada, instalação limpa e atualização, offline/online, câmera, arquivos, teclado e Voltar. Usar dados de homologação.
3. Reconciliar somente as alterações aprovadas e conferir compatibilidade web/backend, mantendo flags bloqueadas.
4. Preparar AAB assinado com versão correta; subir para teste interno apenas com autorização específica e analisar relatório de pré-lançamento.
5. Fazer homologação com conta de teste no track interno antes de autorizar produção.

## Referências oficiais
- Cobrança: https://support.google.com/googleplay/android-developer/answer/9858738?hl=en
- Esclarecimentos de cobrança: https://support.google.com/googleplay/android-developer/answer/10281818?hl=en
- Exclusão de conta: https://support.google.com/googleplay/android-developer/answer/13327111?hl=en
- Target SDK: https://developer.android.com/google/play/requirements/target-sdk
- Páginas de 16 KB: https://developer.android.com/guide/practices/page-sizes

Consumo real de créditos/tokens não disponível para confirmação.

## Complemento — fixture de navegação desatualizada
Após a captura enviada pelo usuário, foi encontrada uma cópia antiga do BottomNav no APK de testes. A rodada anterior não comprovava a versão atual desse menu. O bundle foi regenerado a partir do componente atual, as rotas da fixture e as expectativas Android foram atualizadas, incluindo o botão + para /manual e /renda/nova. Os 5 testes instrumentados de navegação atuais passaram, sem falhas nem skips. Alterações somente na fixture e nos testes; nenhuma publicação. Log: evidence-preplay-20261031/gi-nav-current.log.
