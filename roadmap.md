
- [x] Ativar áudio WhatsApp em produção (flag WHATSAPP_AUDIO_ENABLED + publicar) após ajuste de valores sem "reais"
- [x] P1 Lembretes automáticos — correções internas (recorrência mensal/semanal, fuso do perfil, sem passado, consulta)
- [ ] P1 Lembretes — ativação real: templates Meta gi_agenda_*, cron do dispatcher e WHATSAPP_DISPATCH_ENABLED (aguarda autorização)
- [ ] Assistente de Compras WhatsApp (Fases A/B/C) — bloqueado: aguarda conclusão dos lembretes e chave SERPAPI_API_KEY
- [x] Exclusão reversível de gastos F1 (auditoria/plano) e F2 (migration CANDIDATA + RPCs + testes SQL locais) — NÃO aplicada
- [x] F3 código/testes: leitores de gastos filtram deleted_at (NÃO publicar antes da F2 aplicada)
- [x] P0 nº1: estorno de conta bloqueia gasto vinculado soft-excluído (código; depende da F2)
- [x] P0 undo WhatsApp/site: código + SQL candidato docs/migrations-candidate/whatsapp-undo-soft-delete.sql (NÃO aplicado; aplicar junto com F2)
- [ ] Release rápido WhatsApp: candidato = commit 388a742c (sem deleted_at em gastos); exige regressão e autorização para publicar
- [ ] F3 pendências: reversão de extrato, edit WhatsApp, aviso site, cache offline, RPC transacional de estorno (F4)
- [ ] F4 fluxo WhatsApp exclusão/restauração / F5 ativação — aguardam autorização
- [ ] Cadastro conversacional de cartões
- [ ] Smoke test de áudio real
- [ ] Botões de gasto: versionar sessão após "Ajustar" (tarefa independente)

- [x] Compras MVP (dev): intenção, adaptador SerpApi mockado, cota 10/200 em memória, estimador puro — sem chave, sem pipeline, sem banco
- [ ] Compras: cota persistente (migration candidata, aprovação), ligar ao pipeline com flag desligada, leitura financeira real read-only, chave SERPAPI_API_KEY pelo dono
- [ ] Assistente de Compras: aplicar `docs/migrations-candidate/whatsapp-shopping-quota.sql` (aguarda aprovação), cadastrar `SERPAPI_API_KEY`, ligar `WHATSAPP_SHOPPING_ENABLED` só após homologação; continuações (10x/12x, guardar até mês, qual loja, variante) prontas em DEV com contexto 20 min no mesmo SQL candidato.
