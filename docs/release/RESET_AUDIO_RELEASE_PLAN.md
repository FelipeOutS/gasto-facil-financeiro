# Liberação da limpeza total por áudio — plano final (não executado)

Conta-alvo (confirmada pelo titular): usuário `3324b9f8…`, WhatsApp `…6698`, login verificado `fel…@outlook.com`.

## Pacote de banco (17 itens, uma única transação)
`docs/release/reset-audio-combined.sql` = candidatos na ordem testada:
01 gastos-soft-delete-f2 · 02 financial-offline-generation · 03 account-opening-balances · 04 financial-fact-ledger ·
05 reorganization-card-accounting · 06 whatsapp-reorganizacao · 07 financial-card-visibility · 08 financial-universal-fence ·
09 financial-linked-writer-fence · 10 financial-fact-boundaries · 11 financial-cash-attribution · 12 financial-group-writer ·
13 whatsapp-reorganizacao-partial-scope · 14 whatsapp-reorganizacao-owner-allowlist · 15 whatsapp-reorganizacao-full-reset ·
16 financial-post-reset-writers · 17 whatsapp-reorganizacao-preview-only (trava "somente prévia").

Tudo nasce desligado: `release_enabled=false`, `preview_only=true`, allowlist vazia. Nenhuma função existente do banco real é substituída.

## Sequência (cada etapa exige autorização explícita)
1. Exportação confirmada pelo titular.
2. `reset-audio-preflight.sql` (somente leitura) — já passou no banco real em 05/11.
3. Aplicar o pacote único pela ferramenta de migração (tudo ou nada).
4. `reset-audio-postcheck.sql` (somente leitura) + conferir que gastos/receitas do site e WhatsApp seguem normais.
5. Publicar o código com `WHATSAPP_REORGANIZACAO_RELEASE_AUTHORIZED=false`, `WHATSAPP_REORGANIZACAO_PREVIEW_ONLY=true`, `REORG_ARCHIVE_SCHEMA_DEPLOYED=true`.
6. Liberar só a conta-alvo: inserir na allowlist, `release_enabled=true` (preview_only continua true), publicar com `RELEASE_AUTHORIZED=true`.
7. Primeiro teste real: áudio "GI, exclua tudo" → só a prévia. Qualquer código enviado recebe "modo somente prévia"; o banco também recusa.
8. Só após aprovar a prévia: autorização separada para `preview_only=false` + `WHATSAPP_REORGANIZACAO_PREVIEW_ONLY=false`.

## Reversão
- Antes de qualquer limpeza aplicada: `reset-audio-rollback.sql` (remove gatilhos/políticas novos, restaura chaves únicas originais, torna funções novas não-executáveis; não apaga tabelas, colunas nem dados). Recusa rodar se existir limpeza aplicada.
- Com limpeza aplicada: restaurar primeiro pelo fluxo normal ("restaurar última limpeza" + código); depois reverter.
- Código: republicar a versão anterior; as flags falsas já bloqueiam tudo.
- Último recurso: backup gerado pelo titular.

## Testes (banco temporário descartável)
- `scripts/test-whatsapp-reorganizacao-sql.sh`: 240 PASS (inclui trava somente prévia).
- `scripts/test-reset-audio-release.sh`: pacote único aplica, postcheck, uso normal, bloqueio, reversão completa.
