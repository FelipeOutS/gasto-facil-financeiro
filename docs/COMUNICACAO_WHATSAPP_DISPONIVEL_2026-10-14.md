# Comunicação WhatsApp — revisão local 2026-10-14

## Escopo e resultado
Somente comunicação e apresentação. Não publicado. Sem alterações em backend, entitlement, preços, banco, dados, migrations F2/UNDO/F4, flags, cron, segredos ou Meta. Relatórios históricos preservados.

## Antes/depois com linhas reais
Linhas atuais conferidas por enumeração equivalente a `nl -ba`; linhas anteriores usam a cópia inicial local.

### `src/components/AvisoWhatsAppBanner.tsx` — antes L4–L3; depois L4–L5
```diff
+ import { Link } from "@tanstack/react-router";
+ import { Button } from "@/components/ui/button";
```

### `src/components/AvisoWhatsAppBanner.tsx` — antes L54–L53; depois L56–L58
```diff
+           <Button asChild variant="link" size="sm" className="mt-2 h-auto p-0">
+             <Link to="/whatsapp">{t("whatsappBanner.cta")}</Link>
+           </Button>
```

### `src/components/AvisoWhatsAppBanner.tsx` — antes L55–L55; depois L60–L60
```diff
-         <button
+         <Button
```

### `src/components/AvisoWhatsAppBanner.tsx` — antes L57–L56; depois L62–L63
```diff
+           variant="ghost"
+           size="icon"
```

### `src/components/AvisoWhatsAppBanner.tsx` — antes L62–L62; depois L69–L69
```diff
-         </button>
+         </Button>
```

### `src/components/UpgradeCardsList.tsx` — antes L74–L75; depois L74–L73
```diff
-     // WhatsApp ainda é "em breve": não usar como gancho comercial agora.
-     .filter((it) => it.to !== "/whatsapp")
```

### `src/components/landing/PublicLanding.tsx` — antes L4977–L4983; depois L4977–L4982
```diff
-                 <LandingAnchorLink
-                   section="planos"
-                   className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_-12px_rgba(5,150,105,0.45)] transition-all hover:bg-emerald-700 hover:shadow-[0_16px_32px_-12px_rgba(5,150,105,0.55)]"
-                 >
-                   {t("whatsapp.ctaPrimary")}
-                   <ArrowRight className="h-4 w-4" />
-                 </LandingAnchorLink>
+                 <Button asChild>
+                   <Link to="/whatsapp">
+                     {t("whatsapp.ctaPrimary")}
+                     <ArrowRight className="h-4 w-4" aria-hidden="true" />
+                   </Link>
+                 </Button>
```

### `src/i18n/locales/en/common.json` — antes L154–L155; depois L154–L155
```diff
-         "title": "WhatsApp entries coming soon",
-         "description": "Logging expenses via WhatsApp is not available yet. We'll let you know when it's ready."
+         "title": "WhatsApp available on eligible paid plans",
+         "description": "The financial assistant on WhatsApp is available on eligible paid plans after linking your number and authorizing access. Explore plans to unlock this feature."
```

### `src/i18n/locales/en/dashboard.json` — antes L280–L282; depois L280–L282
```diff
-     "title": "WhatsApp entries coming soon",
-     "novo": "Coming soon",
-     "subtitle": "In a future version, you’ll be able to send expenses through WhatsApp to make daily tracking easier.",
+     "title": "Financial assistant on WhatsApp — available",
+     "novo": "Available",
+     "subtitle": "Available on eligible paid plans after linking your number and authorizing access.",
```

### `src/i18n/locales/en/dashboard.json` — antes L284–L284; depois L284–L284
```diff
-     "cta": "Got it"
+     "cta": "Link my WhatsApp"
```

### `src/i18n/locales/en/landing.json` — antes L867–L868; depois L867–L868
```diff
-     "whatsappTitle": "Add expenses via WhatsApp (coming soon)",
-     "whatsappText": "Soon you'll be able to log expenses via WhatsApp with confirmation before saving. Integration prepared for a future release.",
+     "whatsappTitle": "Financial assistant on WhatsApp — available",
+     "whatsappText": "Log expenses via WhatsApp with confirmation before saving. Available on eligible paid plans after linking your number and authorizing access.",
```

### `src/i18n/locales/en/landing.json` — antes L897–L897; depois L897–L897
```diff
-     "title": "Log expenses via WhatsApp",
+     "title": "Financial assistant on WhatsApp — available",
```

### `src/i18n/locales/en/landing.json` — antes L919–L920; depois L919–L920
```diff
-     "ctaPrimary": "I want to use on WhatsApp",
-     "disclaimer": "Available on paid plans · Beta waitlist."
+     "ctaPrimary": "Link my WhatsApp",
+     "disclaimer": "Available on eligible paid plans after linking your number and authorizing access."
```

### `src/i18n/locales/pt/common.json` — antes L154–L155; depois L154–L155
```diff
-         "title": "Lançamento pelo WhatsApp em breve",
-         "description": "O lançamento de gastos pelo WhatsApp ainda não está disponível. Avisaremos quando estiver pronto."
+         "title": "WhatsApp disponível nos planos pagos elegíveis",
+         "description": "O assistente financeiro pelo WhatsApp está disponível nos planos pagos elegíveis, após vincular seu número e autorizar o acesso. Conheça os planos para liberar esse recurso."
```

### `src/i18n/locales/pt/dashboard.json` — antes L280–L282; depois L280–L282
```diff
-     "title": "Lançamento pelo WhatsApp em breve",
-     "novo": "Em breve",
-     "subtitle": "Em uma próxima versão, você poderá enviar gastos pelo WhatsApp para facilitar o registro no dia a dia.",
+     "title": "Assistente financeiro pelo WhatsApp — disponível",
+     "novo": "Disponível",
+     "subtitle": "Disponível nos planos pagos elegíveis, após vincular seu número e autorizar o acesso.",
```

### `src/i18n/locales/pt/dashboard.json` — antes L284–L284; depois L284–L284
```diff
-     "cta": "Entendi"
+     "cta": "Vincular meu WhatsApp"
```

### `src/i18n/locales/pt/landing.json` — antes L867–L868; depois L867–L868
```diff
-     "whatsappTitle": "Lançamento pelo WhatsApp (em breve)",
-     "whatsappText": "Em breve você poderá registrar gastos pelo WhatsApp com confirmação antes de salvar. Integração preparada para liberação futura.",
+     "whatsappTitle": "Assistente financeiro pelo WhatsApp — disponível",
+     "whatsappText": "Registre gastos pelo WhatsApp com confirmação antes de salvar. Disponível nos planos pagos elegíveis, após vincular seu número e autorizar o acesso.",
```

### `src/i18n/locales/pt/landing.json` — antes L897–L897; depois L897–L897
```diff
-     "title": "Lançamentos pelo WhatsApp",
+     "title": "Assistente financeiro pelo WhatsApp — disponível",
```

### `src/i18n/locales/pt/landing.json` — antes L919–L920; depois L919–L920
```diff
-     "ctaPrimary": "Quero usar no WhatsApp",
-     "disclaimer": "Disponível para planos pagos · Beta por lista de espera."
+     "ctaPrimary": "Vincular meu WhatsApp",
+     "disclaimer": "Disponível nos planos pagos elegíveis, após vincular seu número e autorizar o acesso."
```

### `src/lib/nav-groups.ts` — antes L239–L240; depois L239–L239
```diff
-  * WhatsApp é tratado como recurso futuro (whitelist vazia em plans.ts)
-  * e NÃO deve aparecer em cards de upgrade comerciais. Filtramos aqui.
+  * A apresentação segue o acesso real de cada feature, inclusive WhatsApp.
```

### `src/lib/nav-groups.ts` — antes L242–L242; depois L241–L240
```diff
- const UPGRADE_CARD_FEATURE_BLOCKLIST: ReadonlyArray<FeatureKey> = ["whatsapp"];
```

### `src/lib/nav-groups.ts` — antes L255–L255; depois L253–L253
```diff
-           !!it.feature && !UPGRADE_CARD_FEATURE_BLOCKLIST.includes(it.feature) && !can(it.feature),
+           !!it.feature && !can(it.feature),
```

### `src/routes/app_.ajustes.notificacoes.tsx` — antes L8–L7; depois L8–L8
```diff
+ import { Button } from "@/components/ui/button";
```

### `src/routes/app_.ajustes.notificacoes.tsx` — antes L10–L10; depois L11–L18
```diff
-   head: () => ({ meta: [{ title: "Notificações — Gasto Inteligente" }] }),
+   head: () => ({ meta: [
+     { title: "Notificações — Gasto Inteligente" },
+     { name: "description", content: "Preferências de notificações e canais do Gasto Inteligente, com vínculo do assistente financeiro pelo WhatsApp." },
+     { property: "og:title", content: "Notificações — Gasto Inteligente" },
+     { property: "og:description", content: "Consulte notificações e acesse o vínculo do WhatsApp nos planos pagos elegíveis." },
+     { property: "og:type", content: "website" },
+     { name: "twitter:card", content: "summary" },
+   ] }),
```

### `src/routes/app_.ajustes.notificacoes.tsx` — antes L88–L88; depois L96–L96
```diff
-               { label: "WhatsApp", icon: MessageSquare, active: false, badge: "Em breve" },
+               { label: t("notifications.channels.whatsappAlerts"), icon: MessageSquare, active: false, badge: t("notifications.channels.notEnabled") },
```

### `src/routes/app_.ajustes.notificacoes.tsx` — antes L109–L108; depois L117–L123
```diff
+           <div className="space-y-2 pt-3">
+             <p className="text-sm font-semibold">{t("notifications.channels.assistant")}</p>
+             <p className="text-xs text-muted-foreground">{t("notifications.channels.eligibility")}</p>
+             <Button asChild variant="link" className="h-auto p-0">
+               <Link to="/whatsapp">{t("notifications.channels.link")}</Link>
+             </Button>
+           </div>
```

### `src/routes/index.tsx` — antes L14–L13; depois L14–L14
```diff
+       { property: "og:type", content: "website" },
```

### `src/routes/whatsapp.tsx` — antes L65–L64; depois L65–L69
```diff
+       { name: "description", content: "Assistente financeiro pelo WhatsApp disponível nos planos pagos elegíveis, após vincular seu número e autorizar o acesso." },
+       { property: "og:title", content: "Gastos via WhatsApp — Gasto Inteligente" },
+       { property: "og:description", content: "Vincule seu número e autorize o assistente financeiro pelo WhatsApp nos planos pagos elegíveis." },
+       { property: "og:type", content: "website" },
+       { name: "twitter:card", content: "summary" },
```

### `src/routes/whatsapp.tsx` — antes L836–L838; depois L841–L843
```diff
-                 O número oficial do Gasto Inteligente ainda está em configuração. Por enquanto, você
-                 pode conhecer o funcionamento e testar a interpretação das mensagens pelo simulador
-                 abaixo.
+                 Esta tela está em modo de teste. O assistente financeiro pelo WhatsApp está
+                 disponível em produção nos planos pagos elegíveis, após vincular seu número e
+                 autorizar o acesso. O simulador abaixo permite testar a interpretação das mensagens.
```

### `src/routes/whatsapp.tsx` — antes L897–L897; depois L902–L903
```diff
-                 e responder às suas consultas no app. Avisos podem ser enviados conforme suas preferências.
+                 e responder às suas consultas no app. Alertas automáticos dependem de ativação específica
+                 e não estão incluídos na disponibilidade do assistente financeiro.
```

## Varredura sistemática
Busca case-insensitive com rg por WhatsApp/Whats App e por em breve, coming soon, soon, aguarde lançamento, em construção, lançamento previsto, disponível futuramente, waitlist, lista de espera, próxima versão e future release em src/components, src/routes, src/i18n e public; revisão de landing, banners, bloqueios de upgrade, navegação, planos, comparativos, FAQ e metadados. Sem substituir documentos históricos.

Resultado da primeira varredura (incompleto, retificado pela revisão abaixo): foram removidos os anúncios futuros encontrados, mas dois avisos JSX ainda passaram despercebidos. A afirmação anterior de ausência de ocorrências remanescentes não estava comprovada. O aviso de modo de teste foi distinguido da disponibilidade em produção. Os cards de upgrade deixam de ocultar WhatsApp como futuro, sem conceder acesso. CTAs novos apontam para /whatsapp existente, nunca para número/link inventado.

### Ocorrências legítimas preservadas
- Ajustes: Push futuro; WhatsApp automático explicitamente “Não ativados”, separado do assistente disponível e vinculação.
- Integrações: Open Finance, contas digitais e transformar movimentação em lançamento ainda futuros.
- Mercado: futuros recursos de importação/cards; Radar e investimentos: recursos futuros/API B3.
- “soon/em breve” relativos a vencimentos, fim de teste, início de orçamento e prazo de atendimento não são disponibilidade de WhatsApp.
- BetaAdminSection: ferramentas administrativas legadas restritas ao administrador, não comunicação de disponibilidade pública; APIs/identificadores e comentários internos não alterados.
- docs/ e auditorias: histórico preservado, fora da UI.

## Validação
- Runner isolado: 55 testes aprovados, 0 falhas (31 navegação, 22 gates existentes, 2 apresentação upgrade).
- free-ads-plan: 101 verificações aprovadas, 0 falhas.
- ajustes-07-ux-regressao: 12 testes aprovados, 0 falhas.
- Total: 168 aprovações, 0 falhas. Apenas testes locais/fixtures, sem operações financeiras.
- Build automático da prévia: build OK, última entrada observada 2026-10-14T13:58:29Z. Build e typecheck manuais não executados por restrição do ambiente; não há evidência separada de typecheck nesta tarefa.
- Navegador local: landing PT/EN, larguras 1280 e 390 px, sem overflow horizontal; CTA href /whatsapp e visitante sem sessão chega a /login; nenhum pageerror capturado. Captura desktop PT confirmou visualmente título, CTA e elegibilidade. Capturas mobile PT/EN ficaram em branco na área do título: o texto está no DOM, mas a apresentação mobile NÃO está visualmente verificada; possível comportamento da animação preexistente, não investigado/corrigido nesta tarefa de copy. Não foi executada vinculação, consentimento nem envio WhatsApp; telas autenticadas validadas por código/testes locais, não por operação em conta real.
- Não houve publicação. Créditos exatos: não consigo confirmar.

## Correção tardia identificada pelo proprietário — 14:02 UTC

Referência informada e HEAD conferido no início: `3b0b1de9bc7c6b12c91ea92567f7d65272c8283e`. A revisão anterior falhou ao cobrir texto JSX e uma expressão condicional do simulador; não foi falha nas traduções. Nesta revisão, somente copy em `src/routes/whatsapp.tsx`, este relatório e acompanhamento de tarefa foram alterados.

### Antes/depois (linhas conferidas com `nl -ba`)

| Local | Antes | Depois |
|---|---|---|
| `src/routes/whatsapp.tsx:1068` (comentário, não exibido) e `:1072` (título exibido) | Como vai funcionar quando estiver ativo | Como funciona o assistente pelo WhatsApp |
| `src/routes/whatsapp.tsx:1079` | Você responde sim ou não. | Você informa a forma de pagamento e pode Confirmar, Ajustar ou Cancelar. |
| `src/routes/whatsapp.tsx:1818` (`modoTeste=true`) | Quando o número oficial estiver ativo, você confirmaria com um "sim" no WhatsApp. | Este simulador apenas mostra a interpretação da mensagem, sem salvar dados. Para registrar um gasto, vincule seu número, autorize o acesso e faça a confirmação final no WhatsApp real, disponível nos planos pagos elegíveis. |
| `src/routes/whatsapp.tsx:1819` (`modoTeste=false`) | Para salvar de verdade, envie a mensagem pelo WhatsApp e responda "sim". | Este resultado é apenas uma simulação, sem dados salvos. Para registrar um gasto, vincule seu número, autorize o acesso e faça a confirmação final no WhatsApp real, disponível nos planos pagos elegíveis. |
| `src/routes/whatsapp.tsx:744` (`MODO_TESTE`) | Em configuração | Esta tela está em modo de simulação |
| `src/routes/whatsapp.tsx:747` (`!processamentoRealAtivo`) | Configurado — teste de mensagens ainda desativado | Teste de mensagens nesta tela desativado |
| `src/routes/whatsapp.tsx:1008` (`MODO_TESTE`) | Aguardando ativação | Modo de simulação nesta tela |

Condição `modoTeste`, estado `MODO_TESTE`, handlers, gates, vinculação e persistência preservados. Nenhum envio WhatsApp ou teste financeiro executado.

### Nova busca e classificação

Busca em `src/routes`, `src/components` e `src/i18n` PT/EN por WhatsApp e termos de futuro, incluindo ainda, quando estiver ativo, ainda não disponível, antes de liberar, número em configuração, em breve, vai funcionar, beta, lista de espera e equivalentes EN. Revisadas expressões condicionais do simulador e dos canais de notificações, além dos resultados JSX. Os dois anúncios futuros confirmados acima foram corrigidos; a branch que prescrevia “sim” também foi corrigida.

Ocorrências preservadas e razões:
- `src/routes/whatsapp.tsx:841–843`: modo de teste desta tela, com disponibilidade em produção explicitada; não anuncia lançamento futuro.
- `src/routes/whatsapp.tsx:1065,1743,1817`: condições do simulador, não gates de lançamento; preservadas.
- `src/routes/whatsapp.tsx:744,747,1008`: badges condicionais revisados e reescritos para especificar esta tela/teste, evitando sugerir que o canal aguarda lançamento. Condições intactas; não se afirma processamento ativo quando o sinal consultado está desligado.
- `src/routes/whatsapp.tsx:967,1033,1049`: nenhum número vinculado, sem uso anterior e confirmação pendente de um número específico; estados individuais legítimos, não disponibilidade futura do canal.
- `src/routes/app_.ajustes.notificacoes.tsx:95`: Push “Em breve”, outro canal.
- `src/routes/app_.ajustes.notificacoes.tsx:96` e `src/i18n/locales/{pt,en}/settings.json:64–67`: alertas automáticos “Não ativados”/“Not enabled”; distintos do assistente financeiro disponível.
- `src/components/whatsapp/BetaAdminSection.tsx:100`: “WA-F · Beta fechada do WhatsApp”, ferramenta administrativa legada, renderizada dentro de `isAdmin` em `src/routes/whatsapp.tsx:1129–1247`; não é anúncio público de disponibilidade futura. Não alterada.
- `src/routes/api/public.whatsapp.expense.ts:863`: limitação de identificação de produto por foto, recurso de compras; não anúncio futuro do WhatsApp financeiro, fora da apresentação do site.
- Imports, nomes de funções beta e comentários operacionais: não exibidos ao usuário; preservados. Documentos históricos intactos.

### Validação desta revisão
- Testes existentes: `bun test tests/whatsapp-upgrade-presentation.test.ts`: **2 aprovados, 0 falhas**; `bunx vitest run tests/ajustes-07-ux-regressao.test.ts`: **12 aprovados, 0 falhas**. Nenhum teste permanente de texto/markup adicionado.
- Verificação temporária isolada das duas branches: **2 verificações aprovadas**, sem carregar serviços, executar `onTestar` ou gravar dados. Não equivale a teste visual autenticado.
- Busca pelos avisos antigos e “Você responde sim ou não” em routes/components/i18n: nenhuma ocorrência restante.
- Build automático: **build OK em 2026-10-14T14:03:22Z**. Build/typecheck manuais não executados: o ambiente proíbe execução manual dessas verificações; typecheck separado continua não verificado.
- Playwright local: home **HTTP 200**, CTA existente **`/whatsapp`**, visitante sem sessão direcionado a **`/login`** tanto pelo CTA quanto pelo acesso direto; documento final HTTP 200, nenhum `pageerror`. Tela de login carregada e captura inspecionada. Não houve login, vinculação, execução do simulador nem operação com dados reais; apresentação autenticada verificada apenas em código.
- **Não publicado**; nenhum backend, banco, dado real, flag, segredo, Meta, preço ou migration F2/UNDO/F4 alterado. Créditos exatos: **não consigo confirmar**.
