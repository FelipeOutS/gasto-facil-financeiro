#!/usr/bin/env bash
set -euo pipefail
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE DATABASE_URL || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gi-pg-reorganization.XXXX)"; chmod 777 "$D"
RUN=(); [ "$(id -u)" = 0 ] && RUN=(runuser -u lovable --)
"${RUN[@]}" initdb -D "$D/data" -U gi_test --auth=trust >/dev/null
"${RUN[@]}" pg_ctl -D "$D/data" -o "-k $D -p 55459 -c listen_addresses=''" -l "$D/log" start >/dev/null
trap '"${RUN[@]}" pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p 55459 -U gi_test -d postgres)
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-reorganizacao/00-stub.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/gastos-soft-delete-f2.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/whatsapp-reorganizacao.sql"
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-reorganizacao/10-tests.sql"