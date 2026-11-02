# Release 1 — WhatsApp estável (candidato, NÃO PUBLICADO)

Somente documentação: nada aqui entra no build da versão principal.

- Base: `388a742c772271d62b82b541bfbbc9b5bba6d22b` (sem `deleted_at` em `gastos`; sem F2/F3/P0 soft-delete).
- Patch: `whatsapp-388a-stale-buttons.patch`
- SHA256: `481e7a611bb0f26d866e321fa196508c6c112cc68c7e1946f6bb86db95033bdf`
- Corrige: botão de gasto emitido antes de um Ajuste na MESMA sessão. O ID `exp1:<a>:<sessão>:<rev12>:<mac>`
  agora assina também a revisão (hash canônico de `whatsapp_messages.parsed`); o pipeline recusa se a
  revisão atual divergir. Sem migration, sem segredo novo (mesma subchave HKDF).

## Aplicar numa cópia isolada (nunca na versão principal)

```bash
mkdir /tmp/r1 && git archive 388a742c772271d62b82b541bfbbc9b5bba6d22b | tar -x -C /tmp/r1
cd /tmp/r1 && sha256sum <caminho>/whatsapp-388a-stale-buttons.patch   # conferir hash acima
patch -p1 < <caminho>/whatsapp-388a-stale-buttons.patch
bun install && bunx tsgo --noEmit && bun scripts/test-whatsapp.mjs && bun run build
```

## Critérios (executado em 13/10/2026, cópia isolada, só mocks)

- Typecheck 0 erros; build OK.
- Suíte WhatsApp: 151 arquivos, 2.668 testes, 0 falhas (base sem patch: 151 / 2.664).
- Novos: ajuste de valor, descrição e pagamento → botões anteriores recusados, novos aceitos;
  clique duplo; Cancelar antigo após ajuste; "sim" por texto; revisão adulterada recusada.

Botões `exp1` antigos (sem revisão) passam a ser recusados — seguro porque a 388a nunca foi publicada.
