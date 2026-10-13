#!/usr/bin/env bash
# Homologação LOCAL do Assistente de Compras: um PostgreSQL NOVO e descartável
# (sem rede, só socket unix, usuário não-root), com F2 candidata + SQL de compras
# aplicados SOMENTE nele e dados 100% fictícios. Nunca usa DSN/chaves do projeto.
set -euo pipefail
[ -n "${PG_BIN:-}" ] && export PATH="$PG_BIN:$PATH"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE DATABASE_URL SUPABASE_URL SUPABASE_DB_URL || true
[ "$(id -u)" != "0" ] || { echo "FALHOU: não rode como root"; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gi-homolog.XXXX)"; PORT=55443
initdb -D "$D/data" -U gi_homolog --auth=trust >/dev/null
echo "local all all trust" > "$D/data/pg_hba.conf"   # só socket local; nenhuma regra host
pg_ctl -D "$D/data" -o "-k $D -p $PORT -c listen_addresses=''" -l "$D/log" start >/dev/null
trap 'pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p "$PORT" -U gi_homolog -d postgres)
"${P[@]}" -tAc "select 'ISOLADO versao=' || current_setting('server_version') || ' listen=[' || current_setting('listen_addresses') || '] socket=' || current_setting('unix_socket_directories') || ' hba_host=' || (select count(*) from pg_hba_file_rules where type<>'local') || ' tcp=' || (select count(*) from pg_stat_activity where client_addr is not null) || ' os_user=$(id -un) sysid=' || (select system_identifier from pg_control_system())"
"${P[@]}" -f "$ROOT/tests/sql/gastos-soft-delete-f2/00-stub.sql"
"${P[@]}" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/gastos-soft-delete-f2.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/whatsapp-shopping-quota.sql"
echo "MIGRACOES APLICADAS SO AQUI: gastos-soft-delete-f2.sql, whatsapp-shopping-quota.sql"
"${P[@]}" -f "$ROOT/tests/sql/gastos-soft-delete-f2/10-tests.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR" | sed 's/.*NOTICE: *//'
"${P[@]}" -f "$ROOT/tests/sql/gastos-soft-delete-f2/20-hostile-guc.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR" | sed 's/.*NOTICE: *//'
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-shopping-quota/10-tests.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR" | sed 's/.*NOTICE: *//'
"${P[@]}" -c "truncate whatsapp_shopping_searches"
U=00000000-0000-0000-0000-0000000000aa
for i in $(seq 1 25); do "${P[@]}" -c "set role service_role; select whatsapp_shopping_reserve('$U','c$i')" >/dev/null & done; wait
N=$("${P[@]}" -tAc "select count(*) from whatsapp_shopping_searches where user_id='$U'")
[ "$N" = "10" ] && echo "PASSOU Q14 corrida 25 conexões: $N reservas" || { echo "FALHOU Q14 $N"; exit 1; }
"${P[@]}" -f "$ROOT/tests/sql/homolog-compras/30-finance-fixture.sql" >/dev/null
E=eeeeeeee-0000-0000-0000-00000000000e
"${P[@]}" -tAc "set role service_role; select json_build_object(
 'receitas', (select coalesce(json_agg(r),'[]') from (select id,data,valor::float,descricao,origem,tipo from receitas where user_id='$E' and deleted_at is null and data>='2026-07-01' and data<'2026-10-01') r),
 'gastos', (select coalesce(json_agg(g),'[]') from (select id,data,valor::float,gasto_fixo,recorrencia_id,total_parcelas,parcela_atual,grupo_parcelamento_id from gastos where user_id='$E' and deleted_at is null and (data>='2026-07-01' or total_parcelas>1)) g),
 'recorrencias', (select coalesce(json_agg(x),'[]') from (select id,valor::float,status,frequencia from recorrencias where user_id='$E') x),
 'contas', (select coalesce(json_agg(c),'[]') from (select id,nome,valor::float,status,gasto_id,recorrencia_id,data_vencimento from contas_a_pagar where user_id='$E' and data_vencimento>='2026-10-01') c))" > "$D/rows.json"
bun "$ROOT/tests/sql/homolog-compras/check-finance.ts" "$D/rows.json"
echo "OK: homologação local concluída"
