#!/usr/bin/env bash
# Migração candidata Pluggy em PostgreSQL LOCAL DESCARTÁVEL (sem rede). Inclui corrida de claim.
set -euo pipefail
[ -n "${PG_BIN:-}" ] && export PATH="$PG_BIN:$PATH"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE DATABASE_URL || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gi-pg-pluggy.XXXX)"; chmod 777 "$D"; PORT=55452
RUN=(); [ "$(id -u)" = 0 ] && RUN=(runuser -u nobody --)
"${RUN[@]}" initdb -D "$D/data" -U gi_test --auth=trust >/dev/null
"${RUN[@]}" pg_ctl -D "$D/data" -o "-k $D -p $PORT -c listen_addresses=''" -l "$D/log" start >/dev/null
trap '"${RUN[@]}" pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p "$PORT" -U gi_test -d postgres)
"${P[@]}" -f "$ROOT/tests/sql/pluggy/00-stub.sql"
"${P[@]}" -1 -f "$ROOT/docs/migrations-candidate/pluggy-open-finance.sql"
"${P[@]}" -f "$ROOT/tests/sql/pluggy/10-tests.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"
# Corrida: duas conexões reservam ao mesmo tempo; cada evento sai para só uma.
"${P[@]}" -c "SET ROLE service_role; SELECT public.pluggy_webhook_enqueue('r'||g,'item/updated','iM','{}') FROM generate_series(1,6) g;" >/dev/null
Q="SET ROLE service_role; BEGIN; SELECT id FROM public.pluggy_webhook_claim(50,60); SELECT pg_sleep(1); COMMIT;"
( "${P[@]}" -tAc "$Q" > "$D/a" ) & ( "${P[@]}" -tAc "$Q" > "$D/b" ) & wait
TOT=$(cat "$D/a" "$D/b" | grep -cE '^[0-9a-f-]{36}$'); UNI=$(cat "$D/a" "$D/b" | grep -E '^[0-9a-f-]{36}$' | sort -u | wc -l)
if [ "$TOT" = 6 ] && [ "$UNI" = 6 ]; then echo "PASSOU: corrida 2 conexões — 6 eventos, nenhum reservado duas vezes"; else echo "FALHOU: corrida $TOT/$UNI"; exit 1; fi
# Correção candidata: limite de tentativas com reserva expirada
"${P[@]}" -f "$ROOT/docs/migrations-candidate/pluggy-webhook-claim-max-attempts.sql"
"${P[@]}" -f "$ROOT/tests/sql/pluggy/20-lease-max.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"
"${P[@]}" -f "$ROOT/tests/sql/pluggy/30-amount-original.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"
# Fase 3: importação Pluggy → Gastos/Receitas (candidata)
( cd "$ROOT" && bun tests/sql/pluggy/gen-import-fixture.ts > "$D/seed.sql" )
"${P[@]}" -f "$ROOT/tests/sql/pluggy/35-gi-stub.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/pluggy-import-gi.sql"
"${P[@]}" -f "$ROOT/tests/sql/pluggy/39-release-block.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"
"${P[@]}" -f "$ROOT/tests/sql/pluggy/39-test-only-unlock.sql"
( cd "$ROOT" && "${P[@]}" -v seed_file="$D/seed.sql" -f tests/sql/pluggy/40-import.sql 2>&1 | grep -E "PASSOU|FALHOU|ERROR" )
# F4 candidate tested only here; no pending F2/F4 is applied to shared DB.
"${P[@]}" -f "$ROOT/docs/migrations-candidate/gastos-delete-atomic-f4.sql"
"${P[@]}" -f "$ROOT/tests/sql/pluggy/41-f4-guard.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"
"${P[@]}" -f "$ROOT/tests/sql/pluggy/42-import-race.sql"
Q="SET ROLE service_role; BEGIN; SELECT public.pluggy_import_apply('47df50ce-df1e-4c54-8fae-0ffb5105478d',gen_random_uuid(),(SELECT plan FROM public.test_import_race)); SELECT pg_sleep(1); COMMIT;"
( "${P[@]}" -tAc "$Q" > "$D/ia" ) & A=$!
( "${P[@]}" -tAc "$Q" > "$D/ib" ) & B=$!
wait "$A"; wait "$B"
N=$("${P[@]}" -tAc "SELECT count(*) FROM public.receitas WHERE id_operacao_banco='pluggy:acc1:race-income'")
if [ "$N" = 1 ]; then echo 'PASSOU: corrida importação 2 conexões — uma receita, sem duplicação'; else echo "FALHOU: corrida importação $N"; exit 1; fi
Q="SET ROLE service_role; BEGIN; SELECT public.pluggy_import_revert('47df50ce-df1e-4c54-8fae-0ffb5105478d',(SELECT batch_id FROM public.pluggy_import_entries WHERE transaction_id='race-income')); SELECT pg_sleep(1); COMMIT;"
( "${P[@]}" -tAc "$Q" > "$D/ra" ) & A=$!
( "${P[@]}" -tAc "$Q" > "$D/rb" ) & B=$!
wait "$A"; wait "$B"
N=$("${P[@]}" -tAc "SELECT count(*) FROM public.receitas WHERE id_operacao_banco='pluggy:acc1:race-income' AND deleted_at IS NOT NULL")
if [ "$N" = 1 ] && grep -q '"replay": true' "$D/ra" "$D/rb"; then echo 'PASSOU: corrida desfazer 2 conexões — exclusão reversível única e replay'; else echo "FALHOU: corrida desfazer $N"; exit 1; fi
# Primeira importação real controlada (candidata): trava global restaurada antes.
"${P[@]}" -c "CREATE OR REPLACE FUNCTION public.pluggy_assert_financial_release() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS \$\$ BEGIN RAISE EXCEPTION 'pluggy_gravacao_financeira_bloqueada' USING ERRCODE='42501'; END \$\$;"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/pluggy-live-readonly.sql"
"${P[@]}" -1 -f "$ROOT/docs/migrations-candidate/pluggy-real-first-import.sql"
"${P[@]}" -f "$ROOT/tests/sql/pluggy/50-real-once.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"
# Corrida da nova função: duas conexões, mesma autorização e mesmo lote pré-fixado.
"${P[@]}" -c "INSERT INTO public.pluggy_transactions(user_id,item_id,account_id,transaction_id,dedupe_key,description,amount,date,status,type,classification,classification_reason,is_sandbox) VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','iReal','aReal','race1','k-race1','Rendimentos',0.03,'2026-10-13','POSTED','CREDIT','receita','credito_conta',false); INSERT INTO public.pluggy_real_import_grants(user_id,account_id,transaction_id,entry_table,valor,data,batch_id,expires_at) VALUES ('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','aReal','race1','receitas',0.03,'2026-10-13','00000000-0000-0000-0000-0000000bace1',now()+interval '1 day');" >/dev/null
Q="SET ROLE service_role; BEGIN; SELECT public.pluggy_import_apply_real_once('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','aReal','race1','00000000-0000-0000-0000-0000000bace1','{\"descricao\":\"Rendimentos\",\"valor\":0.03,\"data\":\"2026-10-13\",\"tipo\":\"outros\",\"id_operacao_banco\":\"pluggy:aReal:race1\"}'); SELECT pg_sleep(1); COMMIT;"
( "${P[@]}" -tAc "$Q" > "$D/xa" 2>&1 ) & A=$!
( "${P[@]}" -tAc "$Q" > "$D/xb" 2>&1 ) & B=$!
wait "$A"; wait "$B"
N=$("${P[@]}" -tAc "SELECT count(*) FROM public.receitas WHERE id_operacao_banco='pluggy:aReal:race1'")
E=$("${P[@]}" -tAc "SELECT count(*) FROM public.pluggy_import_entries WHERE transaction_id='race1'")
R=$(cat "$D/xa" "$D/xb" | grep -c '"replay": true' || true); W=$(cat "$D/xa" "$D/xb" | grep -c '"replay": false' || true)
if [ "$N" = 1 ] && [ "$E" = 1 ] && [ "$R" = 1 ] && [ "$W" = 1 ]; then echo 'PASSOU: corrida importação real 2 conexões — 1 receita, 1 entrada, 1 gravação + 1 replay'; else echo "FALHOU: corrida real N=$N E=$E R=$R W=$W"; cat "$D/xa" "$D/xb"; exit 1; fi
Q="SET ROLE service_role; BEGIN; SELECT public.pluggy_import_revert_real_once('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','00000000-0000-0000-0000-0000000bace1'); SELECT pg_sleep(1); COMMIT;"
( "${P[@]}" -tAc "$Q" > "$D/ya" 2>&1 ) & A=$!
( "${P[@]}" -tAc "$Q" > "$D/yb" 2>&1 ) & B=$!
wait "$A"; wait "$B"
N=$("${P[@]}" -tAc "SELECT count(*) FROM public.receitas WHERE id_operacao_banco='pluggy:aReal:race1' AND deleted_at IS NOT NULL")
if [ "$N" = 1 ] && grep -q '"replay": true' "$D/ya" "$D/yb"; then echo 'PASSOU: corrida desfazer real 2 conexões — exclusão reversível única e replay'; else echo "FALHOU: corrida desfazer real $N"; exit 1; fi
# Fase 4: lote fechado (candidata)
"${P[@]}" -1 -f "$ROOT/docs/migrations-candidate/pluggy-real-batch-import.sql"
"${P[@]}" -f "$ROOT/tests/sql/pluggy/60-real-batch.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"
Q="SET ROLE service_role; BEGIN; SELECT public.pluggy_import_apply_real_batch('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','00000000-0000-0000-0000-00000000ba05','[{\"account_id\":\"aReal\",\"transaction_id\":\"c1\",\"descricao\":\"Rendimentos\"},{\"account_id\":\"aReal\",\"transaction_id\":\"c2\",\"descricao\":\"Rendimentos\"}]'); SELECT pg_sleep(1); COMMIT;"
( "${P[@]}" -tAc "$Q" > "$D/za" 2>&1 ) & A=$!
( "${P[@]}" -tAc "$Q" > "$D/zb" 2>&1 ) & B=$!
wait "$A"; wait "$B"
N=$("${P[@]}" -tAc "SELECT count(*) FROM public.receitas WHERE import_batch_id='00000000-0000-0000-0000-00000000ba05'")
R=$(cat "$D/za" "$D/zb" | grep -c '"replay": true' || true); W=$(cat "$D/za" "$D/zb" | grep -c '"replay": false' || true)
if [ "$N" = 2 ] && [ "$R" = 1 ] && [ "$W" = 1 ]; then echo 'PASSOU: corrida lote 2 conexões — 2 receitas, 1 gravação + 1 replay'; else echo "FALHOU: corrida lote N=$N R=$R W=$W"; cat "$D/za" "$D/zb"; exit 1; fi
Q="SET ROLE service_role; BEGIN; SELECT public.pluggy_import_revert_real_batch('3324b9f8-ea68-465c-8e1e-ab1cc8caebf1','00000000-0000-0000-0000-00000000ba05'); SELECT pg_sleep(1); COMMIT;"
( "${P[@]}" -tAc "$Q" > "$D/wa" 2>&1 ) & A=$!
( "${P[@]}" -tAc "$Q" > "$D/wb" 2>&1 ) & B=$!
wait "$A"; wait "$B"
N=$("${P[@]}" -tAc "SELECT count(*) FROM public.receitas WHERE import_batch_id='00000000-0000-0000-0000-00000000ba05' AND deleted_at IS NOT NULL")
if [ "$N" = 2 ] && grep -q '"replay": true' "$D/wa" "$D/wb"; then echo 'PASSOU: corrida desfazer lote 2 conexões — reversão única e replay'; else echo "FALHOU: corrida desfazer lote $N"; exit 1; fi
