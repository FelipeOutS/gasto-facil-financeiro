# Correção da Vulnerabilidade Crítica do `seroval` — Gasto Inteligente

**Data:** 2026-07-31 · **Prompt:** 3 — CVE crítica do `seroval` e atualização segura do TanStack
**Escopo:** apenas dependências + testes + documentação. **Nenhuma migration, nenhum dado, nenhum envio, nenhum pagamento.**

---

## 1. Resumo

| Item | Antes | Depois |
|---|---|---|
| `seroval` resolvido | **1.5.1 (vulnerável)** | **1.5.6 (corrigido)** |
| `seroval-plugins` resolvido | 1.5.1 | 1.5.6 |
| Pacotes TanStack | inalterados | inalterados |
| React / Vite / runtime | 19.2.4 / 7.3.1 / Workers | idênticos |
| Pacotes alterados no lockfile | — | **2** (nenhum outro) |
| Typecheck | 0 erros | 0 erros |
| Runner integral | 2279 testes / 126 arquivos | **2296 testes / 127 arquivos, 0 falhas** |
| Build de produção | ok | ok (exit 0, 1m46s) |

A vulnerabilidade estava numa dependência **transitiva** de 3 pacotes TanStack. Todos declaram `seroval: ^1.4.2`, ou seja **a versão corrigida já era compatível** — não foi necessário atualizar nenhum pacote TanStack, React, Vite ou o runtime.

---

## 2. Advisory (dados atuais do registro oficial, 2026-07-31)

| Campo | Valor |
|---|---|
| GHSA | `GHSA-mv8w-475r-vwqw` |
| CVE | `CVE-2026-59940` |
| Severidade | **Crítica** |
| Pacote | `seroval` (npm) |
| Faixa vulnerável | **`<= 1.5.2`** |
| Primeira versão corrigida | **`1.5.3`** |
| Publicado / atualizado | 2026-07-24 |
| Título | *`seroval.fromJSON()` Promise resolver type confusion invokes attacker-controlled methods during deserialization* |

**Diferença em relação ao relatório anterior:** o relatório citava apenas o GHSA; o advisório oficial agora traz também o CVE `CVE-2026-59940`, a faixa exata `<= 1.5.2` e o patch `1.5.3` — dados usados aqui.

### Vetor e aplicabilidade ao projeto

- **Vetor:** em `fromJSON()`, nós de controle de Promise operavam sobre valores da tabela geral de referências sem verificar se eram registros internos de resolver. Com plugins que devolvem wrappers chamáveis, isso vira invocação server-side não intencional (até RCE, dependendo do que a app expõe).
- **Uso no projeto:** `seroval` é a camada de serialização do TanStack Start — **é usada em produção** (SSR, hidratação, retorno de server functions). Confirmado no bundle: `dist/server/_libs/tanstack__router-core.mjs` e `dist/server/_libs/seroval-plugins.mjs`.
- **Superfícies afetadas em teoria:** SSR, serialização servidor↔cliente, hidratação e qualquer payload de server function. **Cloudflare Workers também**, pois o mesmo código roda no Worker.
- **Explorabilidade no estado atual:** o app não expõe um endpoint que desserialize *Seroval JSON arbitrário fornecido pelo usuário* — o payload desserializado é o que o próprio servidor produziu. Isso **reduz** a probabilidade, mas **não** elimina o risco (o transporte de server functions é o caminho exato afetado). Por isso a correção foi aplicada e não aceita como "não explorável".

---

## 3. Árvore de dependências

### Antes

```text
gasto-inteligente
├── @tanstack/react-router@1.168.10
│   └── @tanstack/router-core@1.168.9
│       ├── seroval@1.5.1              ← VULNERÁVEL (requer ^1.4.2)
│       └── seroval-plugins@1.5.1      ← VULNERÁVEL (requer ^1.4.2)
├── @tanstack/react-start@1.167.16
│   ├── @tanstack/start-client-core@1.167.9
│   │   └── seroval@1.5.1              ← mesma instância hoisted
│   └── @tanstack/start-server-core@1.167.9
│       └── seroval@1.5.1              ← mesma instância hoisted
└── @tanstack/router-plugin@1.167.12
    └── @tanstack/router-core@1.168.9  → seroval (idem)
```

### Depois

```text
gasto-inteligente
├── overrides: seroval=1.5.6, seroval-plugins=1.5.6
├── @tanstack/react-router@1.168.10 → @tanstack/router-core@1.168.9 → seroval@1.5.6 ✔
├── @tanstack/react-start@1.167.16  → start-client-core / start-server-core → seroval@1.5.6 ✔
└── @tanstack/router-plugin@1.167.12 → @tanstack/router-core@1.168.9 → seroval@1.5.6 ✔
```

**Duplicação:** nenhuma. Antes e depois existe **uma única** instalação física (`node_modules/seroval`, `node_modules/seroval-plugins`) — verificado com `find node_modules -type d -name seroval`. Não é dependência opcional nem de desenvolvimento: entra no **bundle de produção** (cliente e Worker).

### Checkpoint de versões

| Pacote | Versão instalada | Direta ou transitiva | Introduz `seroval` | Compatibilidade |
|---|---|---|---|---|
| `@tanstack/react-start` | 1.167.16 | direta | indiretamente (via start-*-core) | ok, inalterado |
| `@tanstack/react-router` | 1.168.10 | direta | indiretamente (via router-core) | ok, inalterado |
| `@tanstack/router-plugin` | 1.167.12 | direta | indiretamente (via router-core) | ok, inalterado |
| `@tanstack/react-query` | 5.95.1 | direta | não | ok |
| `@tanstack/zod-adapter` | 1.166.9 | direta | não | ok |
| `@tanstack/router-core` | 1.168.9 | transitiva | **sim** (`^1.4.2`) | aceita 1.5.6 |
| `@tanstack/start-client-core` | 1.167.9 | transitiva | **sim** (`^1.4.2`) | aceita 1.5.6 |
| `@tanstack/start-server-core` | 1.167.9 | transitiva | **sim** (`^1.4.2`) | aceita 1.5.6 |
| `seroval` | 1.5.1 → **1.5.6** | transitiva (com override) | — | patch dentro da linha 1.5 |
| `seroval-plugins` | 1.5.1 → **1.5.6** | transitiva (com override) | peer `seroval ^1.0` | ok |

Ambiente: Bun 1.3.3 (gerenciador oficial do projeto), Node v22.22.0, lockfile `bun.lockb`, React 19.2.4, Vite 7.3.1, branch `edit/edt-a6ea4c30…`, commit `cb3ac9615`.

---

## 4. Estratégias avaliadas

| Estratégia | Pacotes alterados | Risco | Vantagem | Recomendação |
|---|---|---|---|---|
| **A — override de `seroval`/`seroval-plugins` para 1.5.6** | 2 transitivos | **Baixo**: patch da mesma linha 1.5, aceito por todos os consumidores (`^1.4.2`) | Correção mínima; nenhum pacote TanStack, React, Vite ou runtime alterado | **ESCOLHIDA** |
| B — atualizar toda a linha `@tanstack/*` para a última | 8+ diretos e transitivos | Médio/alto: mudança silenciosa de comportamento em rotas, SSR e server functions; retestes amplos | Sai do override no futuro | Não agora |
| C — subir `seroval` para 1.6.0 (minor) | 2 transitivos | Médio: minor recém-publicado (29/07), fora da linha em uso | Última versão | Não |
| D — não corrigir por "não explorável" | 0 | **Inaceitável**: advisory crítico ativo em código de produção | — | Rejeitada |

Versões experimentais/canary/beta: nenhuma considerada. `1.5.6` foi publicada em 20/07/2026 (fora da janela de 24h do guard de supply chain).

---

## 5. Alterações aplicadas

| Arquivo | Mudança |
|---|---|
| `package.json` | novo bloco top-level `"overrides": { "seroval": "1.5.6", "seroval-plugins": "1.5.6" }` (o bloco `pnpm.overrides` de `entities` foi mantido intacto) |
| `bun.lockb` | regenerado por `bun install` |
| `tests/seroval-cve-2026-59940-serializacao.test.ts` | **novo** — 17 testes |
| `scripts/test-whatsapp.mjs` | 1 linha: novo arquivo de teste incluído no runner integral |
| `docs/CORRECAO_CVE_SEROVAL_GASTO_INTELIGENTE_2026-07-31.md` | **novo** — este documento |
| `docs/RELATORIO_COMPLETO_GASTO_INTELIGENTE_2026-07-31.md` | achado S1 marcado como resolvido |

**Adaptações de código: nenhuma.** A API de `seroval` não mudou entre 1.5.1 e 1.5.6 (patch), portanto nada foi tocado em router, plugin do router, `routeTree.gen.ts`, rotas de API, server functions, SSR, `head()`, redirecionamentos, autenticação, AuthGate ou carregamento de dados. Nenhum `any`, cast inseguro ou regra de lint desativada.

### Lockfile

`bun install` → `2 packages installed`, `Resolved, downloaded and extracted [8]`. Somente `seroval` e `seroval-plugins` mudaram de versão; nenhum pacote adicionado ou removido do grafo, nenhuma atualização acidental de outros pacotes. Nenhum override antigo desnecessário permanece (o único outro é `entities` no bloco pnpm, pré-existente e fora de escopo).

---

## 6. Testes adicionados (17)

`tests/seroval-cve-2026-59940-serializacao.test.ts`, incluído no runner integral:

- **Árvore real (4):** `seroval` e `seroval-plugins` instalados `>= 1.5.3`; override presente no `package.json`; nenhuma versão da faixa vulnerável (1.5.0–1.5.2) resolvida.
- **Round-trip servidor→cliente (7):** string, número, boolean, `null`, `undefined`, arrays, objetos aninhados, `Date` (instante exato), valores financeiros (0,01 até 999.999.999,99 e 55.555.555.555 sem perda de precisão), payload grande (2.000 linhas), `Error` serializado, resposta típica de server function/API JSON.
- **Conteúdo do usuário (3):** `<script>`, `</script><script>`, `onerror=`, SQL, template literal com nome de secret, separadores de linha Unicode, emoji/acentuação — texto preservado literalmente, **nenhuma** ocorrência de `</script>` na string serializada (seguro para inline SSR), e concordância entre `serialize`/`deserialize`/`crossSerialize`.
- **Regressão direta do advisory (3):** payload cujas propriedades são chamáveis (`then`, `resolve`, `onerror`) não invoca nada durante `toJSON`/`fromJSON`; JSON forjado/malformado (nós de Promise falsos apontando para um tripwire global) não executa código nem trava; Promises legítimas continuam resolvendo (`toJSONAsync` + `fromJSON`).

Resultado: nenhuma execução de código, nenhuma injeção, nenhum XSS, nenhuma quebra de hidratação, nenhuma perda de precisão financeira, nenhuma divergência servidor/cliente.

---

## 7. Validações

| Verificação | Resultado |
|---|---|
| Typecheck (`tsgo --noEmit`) | **0 erros** |
| Runner integral (`bun scripts/test-whatsapp.mjs`) | **127 arquivos, 2296 aprovados, 0 falhas** (33,6s) |
| Build de produção (`bun run build`) | **exit 0**, 41,96s de bundling / 1m46s total; 266 assets de cliente, 217 chunks SSR, 1.295 entradas em `routeTree.gen.ts` |
| Cloudflare Workers | `compatibility_flags: ["nodejs_compat"]` preservado em `wrangler.jsonc` e em `dist/server/wrangler.json`; nenhum módulo Node incompatível novo; nenhum import dinâmico quebrado |
| Lint dos arquivos alterados | **0 erros** (`eslint tests/seroval-*.test.ts`) |
| SSR / hidratação / rotas | 12 rotas navegadas com Playwright: `/`, `/login`, `/cadastro`, `/recuperar-senha`, `/termos`, `/privacidade`, `/lgpd`, `/status`, `/app`, `/gastos`, `/renda`, `/meu-plano`, `/admin/saude` → HTTP 200, **zero erros de console e zero erros de página** |
| APIs | `/api/health` → 200 `{"ok":true}`; `/api/public/hooks/whatsapp-dispatcher` sem credencial → **401** (nada enviado); rota inexistente → 404 tratado |
| Dependency scan (npm audit) | "No high or critical severity vulnerabilities" **antes e depois** |

**Sobre o scan:** o scanner de dependências do ambiente (npm audit) **não reportava** este advisory nem antes nem depois — a base do npm audit não continha `GHSA-mv8w-475r-vwqw` para o lockfile do Bun. A evidência da correção é, portanto, a **árvore real**: versão resolvida `1.5.6` contra a faixa vulnerável `<= 1.5.2` do advisório oficial, travada por override e verificada por teste automatizado. Findings críticos/altos/médios/baixos reportados pelo scanner: 0/0/0/0 nas duas execuções.

**Instabilidade observada (não relacionada):** na primeira execução do runner após a atualização, `tests/whatsapp-boleto-c10b-integration.test.ts` falhou 1 teste; isolado passou (258 asserções, 0 falhas) e a reexecução do runner completo ficou 100% verde. Trata-se de flakiness de timing pré-existente nesse arquivo — registrado como pendência de estabilização, sem relação com `seroval`.

---

## 8. Regressão do Prompt 2 — preservado

Somente consultas de leitura:

| Item | Esperado | Verificado |
|---|---|---|
| Receitas físicas | 124 | **124** |
| Receitas ativas | 112 | **112** |
| Receitas em soft delete | 12 | **12** |
| Soma operacional | R$ 515.757,00 | **R$ 515.757,00** |
| Constraint `receitas_valor_valid_range_check` | ativa | **presente** |
| Recorrência fictícia `e6629b5a…` ativa | 0 linhas | **0** |
| Gastos "Csa" | 12 / R$ 48.000,00 | **12 / R$ 48.000,00** |
| Contadores `free_ads` ignoram soft delete | 2 funções | **2** |
| Bug dias 29/30/31 | corrigido | testes verdes no runner |

---

## 9. Publicação

**Não publicado nesta etapa.** Todos os critérios de aceite estão atendidos (vulnerabilidade removida da árvore, typecheck verde, testes verdes, build verde, lint verde, sem regressão, Prompt 2 preservado, nenhuma vulnerabilidade nova). A publicação é **recomendada mas não obrigatória** para esta correção — ela só passa a valer em produção depois do publish, portanto convém publicar para levar `seroval@1.5.6` ao Worker em produção.

Se publicada, serão publicados: `package.json`, `bun.lockb`, `scripts/test-whatsapp.mjs`, o novo teste e os documentos — nenhum arquivo de runtime da aplicação foi alterado.

Smoke tests pós-publicação sugeridos: landing `/`, `/login`, `/app` após login, um lançamento de receita e `/api/health`.

---

## 10. Rollback

Reversão completa em 3 passos (nenhum dado envolvido):

1. `package.json`: remover o bloco top-level `"overrides"` (mantendo `pnpm.overrides`), voltando a resolução para `seroval@1.5.1`/`seroval-plugins@1.5.1`.
2. `bun install` para regenerar `bun.lockb`.
3. Opcional: remover `tests/seroval-cve-2026-59940-serializacao.test.ts` e a linha correspondente em `scripts/test-whatsapp.mjs` (senão os testes de versão falham, apontando corretamente a volta da versão vulnerável).

Depois: `bunx tsgo --noEmit`, `bun scripts/test-whatsapp.mjs`, `bun run build`, dependency scan.

Arquivos a reverter em caso de regressão em produção: `package.json`, `bun.lockb`, `scripts/test-whatsapp.mjs`, `tests/seroval-cve-2026-59940-serializacao.test.ts`. **Rollback não executado — a correção está estável.**

---

## 11. Pendências

- Rotas autenticadas e administrativas não foram exercitadas com sessão real: o ambiente está em `signed_out`, então elas só foram validadas até o gate de autenticação (redirecionamento correto para `/login`). Após o publish, recomenda-se um smoke test manual logado.
- Flakiness de timing em `tests/whatsapp-boleto-c10b-integration.test.ts` (pré-existente).
- O override é uma trava temporária: quando os pacotes TanStack subirem o piso de `seroval` para `>= 1.5.3`, o bloco `overrides` pode ser removido.
- Fora deste escopo e ainda abertos: teste ponta a ponta do Mercado Pago (`payment_events = 0`), templates Meta em `draft`, teto de valor em `gastos`/`contas_a_pagar`/`contas_a_receber`, PWA/Android/iOS.
