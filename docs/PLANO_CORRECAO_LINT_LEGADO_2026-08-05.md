# Plano de Correção do Lint Legado — 2026-08-05 (Prompt 9M)

## 1. Situação medida (após limpeza dos arquivos alterados)

`bunx eslint .` — **exit 1**, 720 arquivos analisados, **45 arquivos com erro**, **4334 errors / 154 warnings**.

| Regra | Errors | Concentração |
|---|---:|---|
| `prettier/prettier` | 4215 | **100% em `src/integrations/supabase/types.ts`** (arquivo auto-gerado) |
| `@typescript-eslint/no-explicit-any` | 80 | 34 arquivos de produção legados |
| `no-useless-escape` | 32 | regex de parsing (WhatsApp/CSV/OCR) |
| `no-control-regex` | 4 | sanitizadores de texto |
| `no-empty` | 2 | `catch {}` silenciosos |
| `@typescript-eslint/no-unused-expressions` | 1 | 1 arquivo |

Top arquivos (excluindo o gerado): `src/routes/api/import-extrato.ts` (19), `src/lib/admin.functions.ts` (12),
`src/lib/recorrencias.ts` (10), `src/routes/admin.tsx` (7), `src/routes/lovable/email/queue/process.ts` (5),
`src/routes/mercado_.preco-comunitario.tsx` (5), `src/lib/csv-fatura.ts` (4), `src/lib/format.ts` (4),
`src/lib/whatsapp-templates-admin.functions.ts` (4).

**Nenhum erro pertence aos arquivos alterados nos Prompts 9H–9M** (esses estão em exit 0).

## 2. Classificação do débito

- **97,3% do débito (4215/4334) é formatação de um artefato auto-gerado** (`supabase/types.ts`), reescrito a cada
  alteração de schema. Corrigir manualmente é inútil: a próxima regeneração desfaz.
- **1,8% (80) é `any` em código legado** — risco de tipagem, não de segurança nem de comportamento.
- **0,9% (39) é regex/`catch` vazio** — ruído estático, sem impacto funcional comprovado (suíte 100% verde).

Conclusão: **débito histórico de estilo/tipagem, sem impacto funcional ou de segurança.**

## 3. Decisão aplicada nesta rodada

1. Arquivos alterados nos Prompts 9H–9M foram **formatados** (`prettier --write`) e tiveram os `any`
   de produção **substituídos por tipos reais** (`UpsellConfig`, `UpsellPrefs`, `UpsellPrefsUpdate`, `AuthedContext`).
2. `eslint.config.js` recebeu um override explícito para `tests/**`, `scripts/**` e `src/scripts/**`
   desligando `no-explicit-any` e `no-require-imports`: harness de teste emula respostas do PostgREST e
   mocks, onde `any` é intencional. **Nenhuma regra foi afrouxada para código de produção.**

## 4. Plano de correção do restante (faseado, fora do caminho de lançamento)

| Fase | Escopo | Ação | Risco |
|---|---|---|---|
| L1 | `src/integrations/supabase/types.ts` | Adicionar ao `.prettierignore` (arquivo auto-gerado) — remove 4215 errors sem tocar em código | Nulo |
| L2 | `no-empty` (2) + `no-unused-expressions` (1) | Correção manual pontual | Nulo |
| L3 | `no-useless-escape` (32) + `no-control-regex` (4) | Revisar cada regex **com teste antes/depois** (parsers de extrato/OCR são sensíveis) | Médio — exige teste por regex |
| L4 | `no-explicit-any` (80) | Tipar por módulo, começando por `import-extrato.ts` e `admin.functions.ts`; um PR por arquivo | Médio |

Ordem recomendada: L1 → L2 → L4 → L3. Cada fase deve terminar com `test:global` + `tsc --noEmit` verdes.
Nenhuma fase deve usar `--fix` em massa sobre `src/` sem rodar a suíte integral em seguida.
