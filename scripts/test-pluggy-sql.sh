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
