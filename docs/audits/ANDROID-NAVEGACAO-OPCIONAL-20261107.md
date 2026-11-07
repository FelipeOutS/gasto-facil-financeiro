# Navegação Android opcional — 07/11/2026

Preparação para revisão no GitHub; sem publicação em produção.

- Ajustes → Aparência oferece “Ocultar navegação do sistema” somente quando o APK expõe a nova ponte nativa. Navegadores e APKs antigos não exibem a opção.
- Preferência do aparelho, desligada por padrão, persistida em SharedPreferences. O interruptor aguarda confirmação da gravação e bloqueia cliques enquanto aguarda.
- MainActivity oculta somente navigationBars via WindowInsetsControllerCompat; status bar permanece visível. BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE permite revelar temporariamente pelo gesto da borda.
- Insets ignoram visibilidade para reservar a área dos botões mesmo ocultos. Isso evita sobreposição e deslocamento do menu quando reaparecem; a área reservada não é recuperada como espaço interativo.
- Atualização exige código web e nova versão Android; AAB 1.1 (código 2) gerado e assinado localmente em 07/11; ainda não enviado ao Play Console.

## Validação

- 3 testes do componente, 9 asserções: APK antigo, confirmação nativa/cliques repetidos, falha de persistência.
- 35 testes existentes de navegação aprovados.
- Typecheck e build web aprovados; build Android debug e androidTest aprovados.
- SystemNavigationTest executado no pacote offlinevalidation em Android 17, uma vez em gestos e uma em três botões: padrão desligado, ocultar, recriar Activity/persistir, reexibir, status bar e reserva de insets.
- Ponte JavaScript real: eventos saved:true ao habilitar e desabilitar. Interruptor React real também operado via CDP.
- Gesto inferior testado com três botões: captura confirmou reaparecimento temporário. Android mostrou orientação de tela cheia na primeira ativação.

## Limitações

Prévia isolada sem dados da conta. Não houve teste em aparelho físico, versões Android antigas ou todos os fabricantes. Fluxos completos de teclado, biometria e retorno de outros aplicativos ainda merecem homologação no celular. Teste instrumentado altera apenas preferência do pacote isolado e a restaura ao terminar. Emulador deixado em três botões para experimentar a opção; interruptor desligado.

Referência: https://developer.android.com/develop/ui/views/layout/immersive
