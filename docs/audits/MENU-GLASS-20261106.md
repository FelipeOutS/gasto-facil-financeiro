# Menu inferior — 06/11/2026

Implementação local, sem push, deploy, banco ou alteração de regras financeiras.

## Alterações
- `src/components/BottomNav.tsx`: superfície de cápsula em lugar do recorte SVG; cinco ações preservadas.
- `src/styles.css`: vidro grafite nos dois temas, fallback opaco, blur de 12px, margem de 8px somada à área segura já existente; toque mínimo de 44px; espaço de rolagem compartilhado; posicionamento de ações de página acima do menu e notificações.
- `src/lib/use-liquid-nav-indicator.ts`: transição de 180ms interrompível, sem deformação; preferência por movimento reduzido preservada.
- `tests/mobile-navigation.test.tsx`: expectativa atualizada para o indicador sem estiramento.
- `src/routes/perfil.tsx`, `src/routes/app_.privacidade.tsx`, `src/routes/gasto-ai.tsx`, `src/routes/mercado_.carrinho.tsx`, `src/routes/mercado_.listas_.$id.tsx`: classe compartilhada somente nos rodapés de página fixos/sticky. Não modifica handlers. Rodapés de diálogos preservados.

## Diagnóstico
A barra tinha margem adicional de 16px e o botão central elevado. O indicador deformava durante a troca. O tratamento Android já combina os insets por máximo, evitando duplicação; não exigiu alteração nativa. Alguns rodapés de página usavam bottom:0 ou uma distância independente da navegação.

## Evidências
- 35 testes de navegação aprovados, 0 falhas, 88 expectativas.
- 8 testes instrumentados Android aprovados (MobileNavigationTest e SiteCompatibilityTest), em pacote isolado com componente web atualizado. Fixture Android original restaurada após teste.
- Chromium: 320/390/480px, claro/escuro, insets 0/24/48px. Cinco ações, seleção, toque, último botão acessível e sheet acima da barra aprovados.
- Verificação isolada do rodapé compartilhado: acima de menu e espaço das notificações; retorno a bottom:0 quando a barra está oculta aprovado.
- Typecheck aprovado. Build final aprovado (log local nav-final-build.log).
- git diff --check dos arquivos desta alteração aprovado.

## Limitações
Não houve validação das telas autenticadas com dados reais, nem medição de FPS em aparelho intermediário físico. Insets de diferentes tamanhos foram simulados no navegador; não foi alternada a configuração de três botões do Android. Testes instrumentados usam fixture dos componentes reais, não uma sessão financeira. A combinação visual de todos os rodapés nas páginas completas ainda deve ser conferida no Preview antes de publicar. Capturas da fixture ficam em %TEMP%/nav-glass-after; tipografia da fixture não representa todas as fontes do app. As alterações preexistentes foram preservadas.


## Ajuste visual no emulador
Superfície com opacidade 58–68% e blur 18px. Prévia aberta no pacote isolado offlinevalidation. Medição real na WebView: viewport ~997px, inset Android 24px, bottom CSS 32px (8px além da área segura). Nenhum offset negativo ou alteração nativa. Não valida ainda três botões nem as páginas autenticadas. Responsividade reexecutada e aprovada após o ajuste.

## Navegação dinâmica — 07/11
Hook use-nav-scroll-size: eventos passivos, requestAnimationFrame, limiar acumulado de 36px e reinício por rota. Larguras 92vw e 78vw com mínimo compacto de 264px para preservar cinco alvos. Transição de 300ms sem escala dos ícones. Mantém altura/insets. Preferência por movimento reduzido, campos focados e diálogos suspendem compactação. Teste reproduzível: scripts/test-nav-scroll-size.mjs recebe o caminho da fixture gerada. Casos 320/390/480px aprovados; 35 testes de navegação e typecheck aprovados. Prévia visual aplicada temporariamente na sessão oficial do emulador; não constitui deploy. Todas as rotas autenticadas e desempenho em celular físico ainda não foram homologados.

## Ancoragem Android — 07/11
Separada a referência fixa (mobile-nav-anchor) da cápsula com largura animada, removida translação do nav. O desfoque inferior termina após a folga de 8px, antes do inset do sistema. Não foi reproduzida a sobreposição exata informada pelo usuário: métricas anteriores já indicavam inset correto. Portanto não se atribui causa comprovada à animação; a separação elimina o acoplamento e a pintura sobre a área nativa. Validação WebView: 168 quadros por modo, insets nativos 24px (gestos) e 48px (três botões), deriva vertical 0px durante expansão/contração. Botão + abriu o painel nos dois estados em WebView. Gestos restaurados após o teste. Trocar o modo recria a Activity e exige autenticação novamente. Regressão responsiva inclui amostragem de posição durante animação. Validação física e reprodução do vídeo original continuam pendentes.
