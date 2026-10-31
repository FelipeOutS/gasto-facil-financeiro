# Cliques e listas invisíveis — 31/10/2026

## Causa reproduzida
No APK em execução no emulador (Android 17, WebView Chrome 153), a página local `/manual` tinha window.innerHeight e visualViewport.height próximos de 997 px, mas 100vh e 100dvh calculavam 0 px. O Select recebia o clique e passava a data-state=open, porém max-height calculava 0 px; a borda produzia uma lista com altura de somente 2 px. As opções existiam no DOM, mas estavam recortadas. Não era ausência de handler nem campo desabilitado.

## Alcance e correção local
O Select compartilhado é importado em 36 arquivos, abrangendo gastos, receitas, contas, clientes, investimentos, reservas, metas, importações e outros filtros. Os usos não representam 36 falhas individualmente reproduzidas; compartilham a causa comprovada.
Foram ajustados limites de altura em 32 arquivos, sem modificar handlers, cálculos, persistência ou permissões. A lista exata está em evidence-clicks-20261031/changed-files.json.
- Select e context menu mantêm o limite de colisão Radix, usando --app-viewport-height no segundo limite.
- Popover, hover card e menubar usam a altura medida já publicada pelo SystemSurfaceProvider.
- Limites percentuais em notificações, modais de gastos, metas, investimentos, contas, importações, relatórios e filas offline preservam sua proporção usando essa mesma medida. Isso evita que classes específicas substituam o limite seguro do Dialog por 85/90vh, ou que listas internas 55/60vh desapareçam.
- O fallback 100dvh continua disponível nos navegadores normais sem a variável. Não foi introduzida detecção por user agent.

## Verificações reais
- Android WebView, página existente, sem salvar: pagamento, mês de referência e fatura abriram e selecionaram a opção já vigente com mouse e toque. 6 cenários aprovados. Alturas observadas: 298, 617,5 e 170 px.
- Medidas de três limites corrigidos no WebView: 973,3 / 548,5 / 897,6 px, em vez de zero.
- Fixture isolada dos componentes reais em Chromium, desktop e toque: seleção e rolagem até a última opção; popover; menu de ações; seletor dentro de modal; fechamento e novo clique depois do modal. 8 cenários aprovados.
- Navegação: 35 testes aprovados. Ciclo de vida de overlays: 9 aprovados. As duas suítes usam registro global Happy DOM e precisam de processos separados: a tentativa conjunta falhou por registro duplicado, não por regressão de UI. Executada novamente a suíte de overlays isolada, aprovada.
- npm run typecheck: passou.
- npm run build: passou; avisos de depreciação inputValidator e configuração Wrangler, sem erro.
- git diff --check: passou.

## Reprodução
1. No ambiente local de desenvolvimento, abrir /manual no emulador e expor a inspeção WebView em 127.0.0.1:9223. scripts/verify-android-clicks.mjs exige explicitamente host loopback e rota /manual, preserva as opções escolhidas e não envia formulário.
2. npx bun scripts/build-interaction-audit.ts <diretório temporário> --serve
3. node scripts/verify-browser-clicks.mjs — fixture em 127.0.0.1:3014, sem sessão, banco ou chamadas financeiras.
4. npx bun test tests/mobile-navigation.test.tsx
5. Em outro processo: npx bun test tests/overlay-lifecycle.test.tsx

## Limites
Não foi percorrido cada fluxo financeiro de ponta a ponta. A confirmação direta Android cobre os três seletores da gravação; o restante combina varredura de usos e testes dos controles compartilhados. Ainda é necessária homologação no celular físico, incluindo teclado, orientação e formulários longos. Nenhuma afirmação de que todos os possíveis problemas de cliques do aplicativo foram eliminados.

Sem push, merge, deploy, nova geração de APK ou alteração de banco. As mudanças estão no código local servido pelo emulador, não no site publicado. Alterações pré-existentes da branch foram preservadas.
