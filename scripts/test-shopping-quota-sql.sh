#!/usr/bin/env bash
# Cota do Assistente de Compras: testa o SQL CANDIDATO num PostgreSQL LOCAL
# DESCARTÁVEL (cluster novo em /tmp, socket unix, sem rede). Nunca usa o Lovable Cloud.
set -euo pipefail
[ -n "${PG_BIN:-}" ] && export PATH="$PG_BIN:$PATH"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE DATABASE_URL || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gi-pg-shop.XXXX)"; PORT=55441
initdb -D "$D/data" -U gi_test --auth=trust >/dev/null
pg_ctl -D "$D/data" -o "-k $D -p $PORT -c listen_addresses=''" -l "$D/log" start >/dev/null
trap 'pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p "$PORT" -U gi_test -d postgres)
"${P[@]}" -tc "select 'ISOLADO listen=[' || current_setting('listen_addresses') || ']'"
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-shopping-quota/00-stub.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/whatsapp-shopping-quota.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/whatsapp-shopping-quota.sql"  # reexecução
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-shopping-quota/10-tests.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"
# Q14 corrida: 25 sessões paralelas do mesmo usuário → no máximo 10 reservas.
"${P[@]}" -c "truncate whatsapp_shopping_searches"
U=00000000-0000-0000-0000-0000000000aa
for i in $(seq 1 25); do "${P[@]}" -c "set role service_role; select whatsapp_shopping_reserve('$U','c$i')" >/dev/null & done; wait
N=$("${P[@]}" -tAc "select count(*) from whatsapp_shopping_searches where user_id='$U'")
[ "$N" = "10" ] && echo "PASSOU Q14 corrida paralela: $N reservas" || { echo "FALHOU Q14 $N"; exit 1; }
echo "OK: testes SQL da cota passaram"
