#!/usr/bin/env bash
set -euo pipefail
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE DATABASE_URL || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gi-pg-reorganization.XXXX)"; chmod 777 "$D"
RUN=(); [ "$(id -u)" = 0 ] && RUN=(setpriv --reuid=1000 --regid=1000 --clear-groups)
"${RUN[@]}" initdb -D "$D/data" -U gi_test --auth=trust >/dev/null
"${RUN[@]}" pg_ctl -D "$D/data" -o "-k $D -p 55459 -c listen_addresses=''" -l "$D/log" start >/dev/null
trap '"${RUN[@]}" pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p 55459 -U gi_test -d postgres)
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-reorganizacao/00-stub.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/gastos-soft-delete-f2.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/financial-offline-generation.sql"
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-reorganizacao/05-account-card-stub.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/account-opening-balances.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/financial-fact-ledger.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/reorganization-card-accounting.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/whatsapp-reorganizacao.sql"
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-reorganizacao/10-tests.sql"
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-reorganizacao/20-balance.sql"
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-reorganizacao/30-compound-card.sql"

"${P[@]}" -f "$ROOT/tests/sql/whatsapp-reorganizacao/50-current-adjustment.sql"

U=aaaaaaaa-0000-0000-0000-000000000001
"${P[@]}" -c "SELECT public.wa_reorganization_prepare('$U','5511999999999','race','{\"tables\":[\"receitas\"],\"start\":null,\"end\":\"2026-11-01\"}',NULL,'888888');"
CALL="SET ROLE service_role; SELECT public.wa_reorganization_confirm('$U','5511999999999','888888',(SELECT id FROM public.whatsapp_reorganization_operations WHERE request_id='race'));"
( "${P[@]}" -tAc "BEGIN; $CALL SELECT pg_sleep(1); COMMIT;" > "$D/r1" 2>&1 ) &
PID=$!
"${P[@]}" -tAc "$CALL" > "$D/r2" 2>&1
wait "$PID"
if grep -q '"applied"' "$D/r1" "$D/r2" && grep -q '"replay"' "$D/r1" "$D/r2"; then echo 'PASS: two connections one apply one replay'; else cat "$D/r1" "$D/r2"; exit 1; fi
"${P[@]}" -f "$ROOT/docs/migrations-candidate/financial-universal-fence.sql"
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-reorganizacao/40-universal-fence.sql"