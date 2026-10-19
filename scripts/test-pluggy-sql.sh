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
