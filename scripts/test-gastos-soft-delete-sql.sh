#!/usr/bin/env bash
# Testa a migration CANDIDATA da exclusão reversível num PostgreSQL LOCAL
# DESCARTÁVEL (cluster novo em /tmp, socket local, sem rede, sem PG* do
# projeto). Nunca conecta ao banco do Lovable Cloud.
set -euo pipefail
[ -n "${PG_BIN:-}" ] && export PATH="$PG_BIN:$PATH"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE DATABASE_URL || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gi-pg-isolado.XXXX)"
PORT=55439
initdb -D "$D/data" -U gi_test --auth=trust >/dev/null
pg_ctl -D "$D/data" -o "-k $D -p $PORT -c listen_addresses=''" -l "$D/log" start >/dev/null
trap 'pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p "$PORT" -U gi_test -d postgres)
"${P[@]}" -c "select 'ISOLADO host=' || current_setting('unix_socket_directories') || ' listen=' || current_setting('listen_addresses') || ' data=' || current_setting('data_directory')"
"${P[@]}" -f "$ROOT/tests/sql/gastos-soft-delete-f2/00-stub.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/gastos-soft-delete-f2.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/gastos-soft-delete-f2.sql"   # reexecução idempotente
"${P[@]}" -f "$ROOT/tests/sql/gastos-soft-delete-f2/10-tests.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"
echo "OK: todos os testes SQL passaram"
