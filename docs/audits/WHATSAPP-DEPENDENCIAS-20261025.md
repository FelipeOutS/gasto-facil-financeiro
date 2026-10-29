# WhatsApp — dependências — 25/10/2026

Instalação limpa npm ci concluída. npm ls final sem problems. Auditoria inicial de produção: 17 alertas, 13 altos. Auditoria final COMPLETA com desenvolvimento: 6 alertas, 4 moderados e 2 baixos, zero altos/críticos. Alertas agregados não são contagem de explorações independentes.

Cloudflare 1.37.1 é a primeira versão estável 1.x consultada no registro npm com Miniflare >=4.20260515.0. Resolve peer do env-runner sem atualizar Nitro/TanStack. Locks sincronizados por migração do package-lock para Bun. Não usado audit fix --force.

## @cloudflare/vite-plugin

- Severidade anterior: moderate.
- Tipo: direta; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 1.32.2 → 1.37.1.
- Estado: permanece low.
- Exposição e impacto: Build/emulação declarada em dependencies. Alerta herdado de esbuild. Não expor servidor dev/preview publicamente.
- Correção indicada pelo audit: {"name":"@cloudflare/vite-plugin","version":"1.65.0","isSemVerMajor":false}.

## @esbuild-kit/core-utils

- Severidade anterior: moderate.
- Tipo: transitiva; instalação: somente dev.
- Versões: 3.3.2 → 3.3.2.
- Estado: permanece moderate.
- Exposição e impacto: Dev: cadeia drizzle-kit/esbuild antigo. npm sugere downgrade drizzle-kit a 0.18.1, inadequado sem revisão API. Não executar servidor público.
- Correção indicada pelo audit: {"name":"drizzle-kit","version":"0.18.1","isSemVerMajor":true}.

## @esbuild-kit/esm-loader

- Severidade anterior: moderate.
- Tipo: transitiva; instalação: somente dev.
- Versões: 2.6.5 → 2.6.5.
- Estado: permanece moderate.
- Exposição e impacto: Dev: cadeia drizzle-kit/core-utils/esbuild, mesmo risco transitivo e restrição.
- Correção indicada pelo audit: {"name":"drizzle-kit","version":"0.18.1","isSemVerMajor":true}.

## @happy-dom/global-registrator

- Severidade anterior: high.
- Tipo: direta; instalação: somente dev.
- Versões: 20.14.6 → 21.0.4.
- Estado: resolvido no audit final.
- Exposição e impacto: Direta de desenvolvimento, herda happy-dom; atualização coordenada 21.0.4, verificar regressões DOM.
- Correção indicada pelo audit: {"name":"@happy-dom/global-registrator","version":"21.0.4","isSemVerMajor":true}.

## @humanfs/node

- Severidade anterior: moderate.
- Tipo: transitiva; instalação: somente dev.
- Versões: 0.16.7 → 0.16.8.
- Estado: resolvido no audit final.
- Exposição e impacto: Lint/dev; cópia com symlinks pode sair da árvore prevista. Patch dentro da faixa.
- Correção indicada pelo audit: true.
  - [humanfs: Recursive copy follows symlinked files and copies data from outside the source tree](https://github.com/advisories/GHSA-p498-v437-472g) — faixa <0.16.8.

## brace-expansion

- Severidade anterior: high.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 5.0.5, 1.1.14, 5.0.6 → 5.0.12, 1.1.21.
- Estado: resolvido no audit final.
- Exposição e impacto: Glob transitivo; padrões maliciosos podem esgotar CPU/memória. Uso em tooling, não entrada WhatsApp.
- Correção indicada pelo audit: true.
  - [brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) — faixa >=3.0.0 <5.0.7.
  - [brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash](https://github.com/advisories/GHSA-mh99-v99m-4gvg) — faixa >=4.0.0 <5.0.8.
  - [brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895) — faixa >=4.0.0 <5.0.9.
  - [brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) — faixa >=4.0.0 <5.0.12.
  - [brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion](https://github.com/advisories/GHSA-qhr7-859c-m2p7) — faixa >=4.0.0 <5.0.11.
  - [brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) — faixa >=4.0.0 <5.0.10.

## drizzle-kit

- Severidade anterior: moderate.
- Tipo: direta; instalação: somente dev.
- Versões: 0.31.11 → 0.31.11.
- Estado: permanece moderate.
- Exposição e impacto: Direta dev de schema; alerta herdado de esbuild. Nenhum servidor ou migração real ativado. Downgrade sugerido não aplicado.
- Correção indicada pelo audit: {"name":"drizzle-kit","version":"0.18.1","isSemVerMajor":true}.

## engine.io

- Severidade anterior: high.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 6.6.7 → 6.6.11.
- Estado: resolvido no audit final.
- Exposição e impacto: Servidor transitivo de devtools; handshake malformado pode causar DoS se exposto.
- Correção indicada pelo audit: true.
  - [Socket.IO: Engine.IO Protocol Revision Mismatch DoS](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv) — faixa >=6.6.0 <6.6.10.

## esbuild

- Severidade anterior: low.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 0.18.20, 0.25.12, 0.28.0, 0.27.7, 0.27.3 → 0.18.20, 0.25.12, 0.28.0, 0.27.7, 0.27.3.
- Estado: permanece moderate.
- Exposição e impacto: Build/dev. Restam servidor legado <=0.24.2 (leitura por origem remota) e 0.27.x no Windows (leitura arbitrária). Não expor serve/dev; build de fontes confiáveis não reproduz esse caminho. Major transitivo 0.x não foi forçado.
- Correção indicada pelo audit: {"name":"drizzle-kit","version":"0.18.1","isSemVerMajor":true}.
  - [esbuild allows arbitrary file read when running the development server on Windows](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) — faixa >=0.27.3 <0.28.1.
  - [esbuild enables any website to send any requests to the development server and read the response](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — faixa <=0.24.2.

## fast-uri

- Severidade anterior: high.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 3.1.2 → 3.1.9.
- Estado: resolvido no audit final.
- Exposição e impacto: Parser de URI em validação/tooling; URI malformada pode desviar normalização de host. Não foi comprovado caminho SSRF alcançável no aplicativo.
- Correção indicada pelo audit: true.
  - [fast-uri vulnerable to host confusion via literal backslash authority delimiter](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) — faixa >=3.0.0 <=3.1.3.
  - [fast-uri vulnerable to host confusion via backslash authority introducer](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) — faixa >=3.0.0 <3.1.5.
  - [fast-uri vulnerable to server-side request forgery via malformed IPv6 normalization](https://github.com/advisories/GHSA-f65p-4m7j-42xc) — faixa >=3.0.0 <3.1.6.
  - [fast-uri vulnerable to server-side request forgery via repeated hostname percent-decoding](https://github.com/advisories/GHSA-fph4-wmhf-6fwf) — faixa >=3.1.2 <3.1.6.
  - [fast-uri vulnerable to host confusion via percent-encoded scheme normalization](https://github.com/advisories/GHSA-jqff-g426-hqxp) — faixa >=3.0.0 <3.1.6.
  - [fast-uri vulnerable to host confusion via failed IDN canonicalization](https://github.com/advisories/GHSA-4c8g-83qw-93j6) — faixa >=3.0.0 <3.1.3.
  - [fast-uri vulnerable to authority injection via an unvalidated port in serialize](https://github.com/advisories/GHSA-qw65-cvwx-89v3) — faixa >=3.0.0 <3.1.7.
  - [fast-uri vulnerable to inconsistent host case normalization via percent-encoded octets](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) — faixa >=3.0.0 <3.1.8.
  - [fast-uri vulnerable to URI scheme spoofing via percent-encoded scheme decoding](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) — faixa >=3.0.0 <3.1.9.
  - [fast-uri vulnerable to improper path equivalence in relative reference normalization](https://github.com/advisories/GHSA-xhq7-xmqj-769h) — faixa >=3.0.0 <3.1.9.
  - [fast-uri vulnerable to scheme injection via an unescaped first-segment colon in suffix references](https://github.com/advisories/GHSA-333x-w4r6-6crp) — faixa >=3.0.0 <3.1.9.

## happy-dom

- Severidade anterior: high.
- Tipo: direta; instalação: somente dev.
- Versões: 20.14.6 → 21.0.4.
- Estado: resolvido no audit final.
- Exposição e impacto: Direta dev; HTML/JS não confiável em testes pode escapar do isolamento. 21.0.4 corrige. Não executa mensagens financeiras em produção.
- Correção indicada pelo audit: {"name":"happy-dom","version":"21.0.4","isSemVerMajor":true}.
  - [Happy DOM: Incomplete fix for CVE-2026-33943: unsanitized import alias leads to host code execution](https://github.com/advisories/GHSA-834v-8h66-3h79) — faixa >=17.0.0 <=21.0.3.

## js-yaml

- Severidade anterior: high.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 4.1.1 → 4.3.2.
- Estado: resolvido no audit final.
- Exposição e impacto: Parser de configuração; aliases/merge de YAML malicioso podem causar DoS. Não há ingestão WhatsApp de YAML.
- Correção indicada pelo audit: true.
  - [JS-YAML: Quadratic-complexity DoS in merge key handling via repeated aliases](https://github.com/advisories/GHSA-h67p-54hq-rp68) — faixa >=4.0.0 <=4.1.1.
  - [js-yaml: YAML merge-key chains can force quadratic CPU consumption](https://github.com/advisories/GHSA-52cp-r559-cp3m) — faixa >=4.0.0 <4.3.0.
  - [JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) — faixa >=4.0.0 <4.3.1.
  - [js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources](https://github.com/advisories/GHSA-2883-xcg3-v3hh) — faixa >=4.0.0 <4.3.2.

## miniflare

- Severidade anterior: high.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 4.20260410.0 → 4.20260515.0.
- Estado: resolvido no audit final.
- Exposição e impacto: Emulação local transitiva de Cloudflare; exposição depende de HTTP/proxy/WebSocket do emulador.
- Correção indicada pelo audit: true.

## nanoid

- Severidade anterior: high.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 3.3.11 → 3.3.20.
- Estado: resolvido no audit final.
- Exposição e impacto: Gerador transitivo; tamanhos numéricos inválidos podem travar. Não significa que todo ID gerado seja inseguro.
- Correção indicada pelo audit: true.
  - [nanoid: non-secure generators can loop indefinitely with negative size](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) — faixa <3.3.16.
  - [nanoid: custom generators can loop indefinitely when size is zero](https://github.com/advisories/GHSA-2v37-7h3g-55p8) — faixa <3.3.18.
  - [nanoid: Integer Overflow or Wraparound](https://github.com/advisories/GHSA-xwg4-73v4-xw9w) — faixa <3.3.12.

## postcss

- Severidade anterior: high.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 8.5.9 → 8.5.31.
- Estado: resolvido no audit final.
- Exposição e impacto: Build CSS; CSS/sourcemap não confiável pode causar leitura de arquivos/saída insegura. Entradas são fontes do projeto.
- Correção indicada pelo audit: true.
  - [PostCSS has XSS via Unescaped </style> in its CSS Stringify Output](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) — faixa <8.5.10.
  - [PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments](https://github.com/advisories/GHSA-6g55-p6wh-862q) — faixa <=8.5.11.
  - [PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) — faixa <=8.5.22.
  - [PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure](https://github.com/advisories/GHSA-r28c-9q8g-f849) — faixa <=8.5.17.

## sharp

- Severidade anterior: high.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 0.34.5 → 0.35.5.
- Estado: resolvido no audit final.
- Exposição e impacto: Parser nativo de imagens transitivo do emulador. Imagem maliciosa pode explorar bibliotecas nativas. Override 0.35.5 atualiza libvips/libheif/librsvg; validar binário no runtime alvo.
- Correção indicada pelo audit: true.
  - [sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) — faixa <0.35.0.
  - [sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) — faixa <0.35.4.
  - [sharp : Vulnerability in librsvg dependency CVE-2026-96889](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) — faixa <0.35.5.

## socket.io-adapter

- Severidade anterior: moderate.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 2.5.6 → 2.5.6.
- Estado: resolvido no audit final.
- Exposição e impacto: Metavulnerabilidade herdada de ws; atualizar ws remove alerta sem reescrever transporte.
- Correção indicada pelo audit: true.

## socket.io-parser

- Severidade anterior: high.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 4.2.6 → 4.2.7.
- Estado: resolvido no audit final.
- Exposição e impacto: Parser transitivo de devtools; payload remoto pode consumir memória.
- Correção indicada pelo audit: true.
  - [Socket.IO: Zero-attachment Memory Exhaustion](https://github.com/advisories/GHSA-2m8v-j782-fhvr) — faixa >=4.0.0 <4.2.7.

## source-map-js

- Severidade anterior: high.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 1.2.1 → 1.2.2.
- Estado: resolvido no audit final.
- Exposição e impacto: Mapas de código não confiáveis podem consumir CPU; usado no build, não processamento financeiro.
- Correção indicada pelo audit: true.
  - [source-map-js allows event-loop denial of service through indexed source-map section offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) — faixa >=1.0.0 <1.2.2.

## undici

- Severidade anterior: high.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 7.24.4 → 7.30.1.
- Estado: resolvido no audit final.
- Exposição e impacto: Cliente HTTP transitivo do emulador; respostas/proxies/cookies maliciosos podem alcançar parsers vulneráveis. Override 7.30.1 mantém major 7.
- Correção indicada pelo audit: true.
  - [undici vulnerable to TLS certificate validation bypass via dropped requestTls in SOCKS5 ProxyAgent](https://github.com/advisories/GHSA-vmh5-mc38-953g) — faixa >=7.23.0 <7.28.0.
  - [undici vulnerable to HTTP header injection via Set-Cookie percent-decoding](https://github.com/advisories/GHSA-p88m-4jfj-68fv) — faixa >=7.0.0 <7.28.0.
  - [undici WebSocket client vulnerable to denial of service via fragment count bypass](https://github.com/advisories/GHSA-vxpw-j846-p89q) — faixa >=7.0.0 <7.28.0.
  - [undici vulnerable to cross-origin request routing via SOCKS5 proxy pool reuse](https://github.com/advisories/GHSA-hm92-r4w5-c3mj) — faixa >=7.23.0 <7.28.0.
  - [undici vulnerable to Set-Cookie SameSite attribute downgrade via permissive substring matching](https://github.com/advisories/GHSA-g8m3-5g58-fq7m) — faixa >=7.0.0 <7.28.0.
  - [undici vulnerable to cross-user information disclosure via shared cache whitespace bypass](https://github.com/advisories/GHSA-pr7r-676h-xcf6) — faixa >=7.0.0 <7.28.0.
  - [undici vulnerable to downstream response desynchronization via retry interceptor](https://github.com/advisories/GHSA-8xcm-r25x-g524) — faixa >=7.0.0 <7.29.0.
  - [undici vulnerable to cross-user information disclosure and parse-time crash via degenerate private cache directives](https://github.com/advisories/GHSA-4cwx-7wf7-3272) — faixa >=7.0.0 <7.29.0.
  - [undici vulnerable to CRLF Injection via blob-like body 'type' property](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5) — faixa >=7.0.0 <7.29.0.
  - [undici vulnerable to cross-user information disclosure via whitespace around equals in Cache-Control directives](https://github.com/advisories/GHSA-jr45-8vmc-qm54) — faixa >=7.0.0 <7.29.0.
  - [undici vulnerable to cookie attribute injection via unsanitized domain and unparsed setCookie fields](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) — faixa >=7.0.0 <7.29.0.
  - [undici vulnerable to HTTP response queue poisoning via keep-alive socket reuse](https://github.com/advisories/GHSA-35p6-xmwp-9g52) — faixa >=7.0.0 <7.28.0.
  - [undici vulnerable to Denial of Service via orphaned RetryHandler response body](https://github.com/advisories/GHSA-pmjh-fq2x-6v4x) — faixa >=7.11.0 <7.29.1.
  - [undici vulnerable to downstream response splitting via retry interceptor](https://github.com/advisories/GHSA-r53p-7pc4-xj5r) — faixa >=7.0.0 <7.29.1.
  - [undici vulnerable to Denial of Service via unrequested WebSocket subprotocol](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5) — faixa >=7.0.0 <7.29.1.
  - [undici vulnerable to Denial of Service via unbounded decompression of compressed responses](https://github.com/advisories/GHSA-3xpg-4rpp-hhhm) — faixa >=7.15.0 <7.29.1.
  - [undici vulnerable to cross-user cookie disclosure via Set-Cookie caching in shared caches](https://github.com/advisories/GHSA-2jfj-6hjv-fm6j) — faixa >=7.0.0 <7.29.1.
  - [undici vulnerable to response truncation via oversized chunked responses in the dump interceptor](https://github.com/advisories/GHSA-2gqq-gqf2-x968) — faixa >=7.1.0 <7.29.1.
  - [undici vulnerable to TLS certificate validation bypass via dropped connect options in BalancedPool](https://github.com/advisories/GHSA-w293-vg96-wgc3) — faixa >=7.24.1 <7.29.1.
  - [undici vulnerable to caching and replay of unsafe HTTP method responses](https://github.com/advisories/GHSA-8436-99hf-9mmv) — faixa >=7.0.0 <7.29.1.
  - [undici vulnerable to Denial of Service via WebSocketStream unclean close](https://github.com/advisories/GHSA-rx4f-c7p8-82vq) — faixa >=7.0.0 <7.29.1.
  - [undici vulnerable to Denial of Service via unbounded memory in the EventSource parser](https://github.com/advisories/GHSA-4qv8-2p9j-2685) — faixa >=7.0.0 <7.30.1.
  - [undici vulnerable to Subresource Integrity bypass via non-lowercase algorithm tokens](https://github.com/advisories/GHSA-f72v-6w45-q472) — faixa >=7.15.0 <7.30.1.
  - [undici vulnerable to Denial of Service via unhandled error on excessive content-encodings](https://github.com/advisories/GHSA-xjj6-f33q-929c) — faixa >=7.18.0 <7.30.1.

## vite

- Severidade anterior: high.
- Tipo: direta; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 7.3.2 → 7.3.7.
- Estado: resolvido no audit final.
- Exposição e impacto: Servidor dev/build; exploração depende de servidor dev exposto. Atualização dentro da linha 7, sem migrar TanStack.
- Correção indicada pelo audit: true.
  - [launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) — faixa >=7.0.0 <=7.3.4.
  - [vite: `server.fs.deny` bypass on Windows alternate paths](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) — faixa >=7.0.0 <=7.3.4.
  - [launch-editor: escapeCmdArgs() omits % escaping on Windows](https://github.com/advisories/GHSA-698v-4r3x-3vcv) — faixa >=7.0.0 <=7.3.6.
  - [launch-editor: Editor CLI flag misinterpretation causing arbitrary command execution for some editors](https://github.com/advisories/GHSA-r825-w8mm-5pxw) — faixa >=7.0.0 <=7.3.6.
  - [launch-editor: `fs.existsSync()` existence check can be bypassed on Windows](https://github.com/advisories/GHSA-587h-7wmj-h5pm) — faixa >=7.0.0 <=7.3.6.
  - [Vite: Cross origin script execution through Vite custom middleware](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) — faixa >=7.0.0 <=7.3.6.
  - [Vite: Files outside `server.fs.allow` could be served when project paths match system paths on non-Windows machine](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) — faixa >=7.0.0 <=7.3.6.

## wrangler

- Severidade anterior: moderate.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 4.82.2 → 4.92.0.
- Estado: permanece low.
- Exposição e impacto: CLI/emulador Cloudflare; risco herdado do servidor esbuild em Windows. Não é o endpoint financeiro publicado.
- Correção indicada pelo audit: {"name":"@cloudflare/vite-plugin","version":"1.65.0","isSemVerMajor":false}.

## ws

- Severidade anterior: high.
- Tipo: transitiva; instalação: árvore de produção, sem implicar execução em runtime.
- Versões: 8.22.0, 8.18.3, 8.18.0 → 8.22.0.
- Estado: resolvido no audit final.
- Exposição e impacto: WebSocket em tooling/emulação; fragmentos maliciosos podem consumir memória. Override 8.22.0 mantém major 8 e atende devtools.
- Correção indicada pelo audit: true.
  - [ws: Uninitialized memory disclosure](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) — faixa >=8.0.0 <8.20.1.
  - [ws: Memory exhaustion DoS from tiny fragments and data chunks](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) — faixa >=8.0.0 <8.21.0.

## Riscos restantes

Os seis alertas residuais não bloqueiam PR sob estas restrições: nenhum servidor dev/preview público, nenhuma fonte não confiável executada por tooling. Não foi identificado endpoint do app publicado expondo esses servidores; isso não é prova de ausência de risco. Bloqueiam publicar essas ferramentas como serviço acessível a terceiros. Validar Node/bibliotecas nativas da plataforma antes do deploy. Esbuild 0.x não foi sobrescrito globalmente com API incompatível, nem Drizzle rebaixado para silenciar audit. Nenhuma implementação Pluggy alterada.
