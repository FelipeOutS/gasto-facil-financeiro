#!/usr/bin/env bash
# F4 candidata em PostgreSQL LOCAL DESCARTÁVEL (sem rede). Inclui corrida com 2 conexões.
set -euo pipefail
[ -n "${PG_BIN:-}" ] && export PATH="$PG_BIN:$PATH"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE DATABASE_URL || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gi-pg-f4.XXXX)"; chmod 777 "$D"; PORT=55441
RUN=(); [ "$(id -u)" = 0 ] && RUN=(runuser -u nobody --)
"${RUN[@]}" initdb -D "$D/data" -U gi_test --auth=trust >/dev/null
"${RUN[@]}" pg_ctl -D "$D/data" -o "-k $D -p $PORT -c listen_addresses=''" -l "$D/log" start >/dev/null
trap '"${RUN[@]}" pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p "$PORT" -U gi_test -d postgres)
"${P[@]}" -f "$ROOT/tests/sql/gastos-soft-delete-f2/00-stub.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/gastos-soft-delete-f2.sql"
"${P[@]}" -f "$ROOT/tests/sql/gastos-delete-atomic-f4/00-stub.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/gastos-delete-atomic-f4.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/gastos-delete-atomic-f4.sql"  # reexecução
"${P[@]}" -f "$ROOT/tests/sql/gastos-delete-atomic-f4/10-tests.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"
# Corrida: conexão 1 marca excluído e segura a transação; conexão 2 tenta estornar.
A=aaaaaaaa-0000-0000-0000-000000000001
"${P[@]}" -c "INSERT INTO public.gastos(id,user_id,valor,data) VALUES ('f1000000-0000-0000-0000-000000000001','$A',1,'2026-09-01'),('f1000000-0000-0000-0000-000000000002','$A',1,'2026-09-01'); INSERT INTO public.contas_a_pagar VALUES ('cf000000-0000-0000-0000-000000000001','$A','pago','2026-09-01',NULL);"
( "${P[@]}" -c "BEGIN; SET LOCAL gi.gastos_soft_delete='on'; UPDATE public.gastos SET deleted_at=now(), deleted_by=user_id, deletion_batch_id=gen_random_uuid(), deletion_source='teste' WHERE id='f1000000-0000-0000-0000-000000000002'; SELECT pg_sleep(2); COMMIT;" ) &
sleep 0.5
OUT=$("${P[@]}" -c "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','$A',false); SELECT public.estornar_conta_gastos_atomic('cf000000-0000-0000-0000-000000000001', ARRAY['f1000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000002']::uuid[]);" 2>&1 || true)
wait
N=$("${P[@]}" -tAc "SELECT count(*) FROM public.gastos WHERE id IN ('f1000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000002')")
if echo "$OUT" | grep -q gasto_vinculado_excluido && [ "$N" = 2 ]; then echo "PASSOU: corrida 2 conexões — bloqueado, nada apagado"; else echo "FALHOU: corrida ($N) $OUT"; exit 1; fi
echo "OK F4"
