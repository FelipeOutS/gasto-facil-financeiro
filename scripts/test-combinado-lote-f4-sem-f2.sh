#!/usr/bin/env bash
# Lote mensal + F4 aplicadas SEM a F2, no formato atual da produção. PostgreSQL LOCAL DESCARTÁVEL apenas.
set -euo pipefail
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE DATABASE_URL || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gi-pg-comb.XXXX)"; chmod 777 "$D"; PORT=55447
RUN=(); [ "$(id -u)" = 0 ] && RUN=(runuser -u nobody --)
"${RUN[@]}" initdb -D "$D/data" -U gi_test --auth=trust >/dev/null
"${RUN[@]}" pg_ctl -D "$D/data" -o "-k $D -p $PORT -c listen_addresses=''" -l "$D/log" start >/dev/null
trap '"${RUN[@]}" pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p "$PORT" -U gi_test -d postgres)
"${P[@]}" -f "$ROOT/tests/sql/combinado-lote-f4-sem-f2/00-stub-producao.sql"
for i in 1 2; do  # ordem proposta + reexecução idempotente
  "${P[@]}" -f "$ROOT/docs/migrations-candidate/whatsapp-lote-mes.sql"
  "${P[@]}" -f "$ROOT/docs/migrations-candidate/gastos-delete-atomic-f4.sql"
done
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-lote-mes/10-tests.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"
"${P[@]}" -f "$ROOT/tests/sql/combinado-lote-f4-sem-f2/20-cruzados.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"
echo "OK combinado sem F2"
