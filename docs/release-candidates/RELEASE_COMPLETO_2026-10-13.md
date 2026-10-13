# Release completo — pacote candidato (NÃO PUBLICADO)

Base: HEAD b4b81b65 + correções deste pacote. Nada aplicado em banco real.

## Por que a publicação depende da migração
O código lê `gastos.deleted_at` (F3). Sem a F2 aplicada, o carregamento de gastos falha.
Publicar só DEPOIS de aplicar as migrações abaixo, na mesma janela.

## Ordem das migrações candidatas (uma janela só)
1. `docs/migrations-candidate/gastos-soft-delete-f2.sql` — colunas de exclusão reversível + RPCs (45 testes locais).
2. `docs/migrations-candidate/whatsapp-undo-soft-delete.sql` — Desfazer do WhatsApp não apaga excluídos.
3. `docs/migrations-candidate/gastos-delete-atomic-f4.sql` — estorno de conta e reversão de extrato tudo-ou-nada (15 testes locais, inclui corrida com 2 conexões).
4. `docs/migrations-candidate/whatsapp-shopping-quota.sql` — cotas do Assistente de Compras (10/usuário, 200 globais).
Logo após: publicar o app (mesma janela).

## Antes da janela (dono)
- Backup completo com TESTE DE RESTAURAÇÃO em ambiente separado.
- Conferir donos/grants/RLS das funções novas (somente leitura de metadados).
- Flags OFF: `WHATSAPP_SHOPPING_ENABLED`, `WHATSAPP_DISPATCH_ENABLED`.

## Rollback
- App: republicar a versão anterior SÓ junto com a reversão das RPCs; as colunas novas ficam (são opcionais e não apagam dados).
- RPCs F4/compras: `DROP FUNCTION` (não toca dados). Nunca apagar linhas marcadas como excluídas.

## Ligar depois (cada um com aprovação)
1. Compras: cadastrar `SERPAPI_API_KEY` como segredo de produção (dono, fora do chat), smoke test com número autorizado, depois `WHATSAPP_SHOPPING_ENABLED=true`.
2. Lembretes proativos: aprovar templates UTILITY `gi_agenda_lembrete` e `gi_agenda_financeiro` na Meta, depois agendador + `WHATSAPP_DISPATCH_ENABLED`. Dentro da janela de 24h responde texto normal; fora dela só template aprovado.

## Pendências conhecidas
- Áudio real no WhatsApp: não verificado.
- Site ainda chama os DELETE condicionais (seguros por linha); trocar para as RPCs F4 após a migração.
- Análise financeira de compras: validada só com dados fictícios; conferir com conta de teste após F2.
