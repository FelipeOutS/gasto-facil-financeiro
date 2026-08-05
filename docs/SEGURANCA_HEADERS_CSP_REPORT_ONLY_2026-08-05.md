# Segurança: Headers HTTP e CSP Report-Only (WA-SEC-CA-01)

## Status: EM MITIGAÇÃO REAL ✅

### 1. Diagnóstico e Resolução
Identificamos que a injeção manual de headers em rotas individuais não cobria as páginas HTML servidas pelo TanStack Start. A solução definitiva foi a implementação do **Server Entry personalizado** em `src/server.ts`.

### 2. Implementação
- **Server Entry**: `src/server.ts` utiliza `createServerEntry` do `@tanstack/react-start/server-entry` para interceptar todas as respostas do servidor.
- **Detecção de Documento**: Aplicamos headers de segurança (XFO, CSP-RO) apenas em respostas `text/html` ou requisições de navegação (`sec-fetch-dest: document`).
- **Headers Globais**:
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy-Report-Only`: Política restritiva com report para `/api/public/csp-report`.
  - `X-Content-Type-Options: nosniff` (Aplicado a todas as respostas).

### 3. Coleta de Violações (Audit Trail)
- **Endpoint**: `/api/public/csp-report`
- **Segurança**: Limite de 10KB por payload, sanitização de URLs (remoção de query/hash) para evitar vazamento de tokens PII.
- **Persistência**: Tabela `whatsapp_csp_reports` com RLS e retenção de 7 dias.

### 4. Evidências (Preview Local)
```text
HTTP/1.1 200
x-frame-options: DENY
content-security-policy-report-only: default-src 'self'; ...
x-content-type-options: nosniff
```

### 5. Próximos Passos (Prompt 12B)
1. Analisar relatórios recebidos na tabela `whatsapp_csp_reports`.
2. Implementar Nonce/Hash para scripts inline.
3. Migrar para `Content-Security-Policy` (Enforce).
