#!/usr/bin/env bash
# Candidata whatsapp-lote-mes em PostgreSQL LOCAL DESCARTÁVEL (sem rede).
set -euo pipefail
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE DATABASE_URL || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gi-pg-lm.XXXX)"; chmod 777 "$D"; PORT=55452
RUN=(); [ "$(id -u)" = 0 ] && RUN=(runuser -u nobody --)
"${RUN[@]}" initdb -D "$D/data" -U gi_test --auth=trust >/dev/null
"${RUN[@]}" pg_ctl -D "$D/data" -o "-k $D -p $PORT -c listen_addresses=''" -l "$D/log" start >/dev/null
trap '"${RUN[@]}" pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p "$PORT" -U gi_test -d postgres)
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-lote-mes/00-stub.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/whatsapp-lote-mes.sql"
"${P[@]}" -f "$ROOT/docs/migrations-candidate/whatsapp-lote-mes.sql"  # reexecução
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-lote-mes/10-tests.sql" 2>&1 | grep -E "PASSOU|FALHOU|ERROR"

U=cccccccc-0000-0000-0000-000000000003
# Falha no meio: gatilho recusa a 2ª linha → rollback total.
"${P[@]}" -c "INSERT INTO public.gastos(id,user_id,descricao,valor,data,forma_pagamento) VALUES
 ('e0000000-0000-0000-0000-000000000001','$U','x',1,'2026-07-01','pix'),('e0000000-0000-0000-0000-000000000002','$U','y',2,'2026-07-02','pix');
 CREATE FUNCTION public.tg_falha() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN IF NEW.id='e0000000-0000-0000-0000-000000000002' THEN RAISE EXCEPTION 'falha_simulada'; END IF; RETURN NEW; END \$\$;
 CREATE TRIGGER falha BEFORE UPDATE ON public.gastos FOR EACH ROW EXECUTE FUNCTION public.tg_falha();"
CALL="SET ROLE service_role; SELECT public.wa_lote_mes_excluir('$U','44444444-0000-0000-0000-000000000001','gastos',2026,7,(SELECT array_agg(id ORDER BY id) FROM public.gastos WHERE user_id='$U'),(SELECT array_agg(updated_at ORDER BY id) FROM public.gastos WHERE user_id='$U'));"
OUT=$("${P[@]}" -tAc "$CALL" 2>&1 || true)
N=$("${P[@]}" -tAc "SELECT count(*) FROM public.gastos WHERE user_id='$U' AND deleted_at IS NULL")||true
L=$("${P[@]}" -tAc "SELECT count(*) FROM public.whatsapp_lote_mes_acoes WHERE user_id='$U'")
if echo "$OUT" | grep -q falha_simulada && [ "$N" = 2 ] && [ "$L" = 0 ]; then echo "PASSOU: falha no meio → rollback total (2 ativos, nenhum lote)"; else echo "FALHOU: rollback $N $L $OUT"; exit 1; fi
"${P[@]}" -c "DROP TRIGGER falha ON public.gastos;"

# Duas conexões com o MESMO lote (duplo Confirmar/webhook duplicado): 1 exclui, a outra vê replay.
( "${P[@]}" -tAc "BEGIN; $CALL SELECT pg_sleep(1.5); COMMIT;" > "$D/c1" 2>&1 ) &
sleep 0.4
"${P[@]}" -tAc "$CALL" > "$D/c2" 2>&1
wait
N=$("${P[@]}" -tAc "SELECT count(*) FROM public.gastos WHERE user_id='$U' AND deleted_at IS NOT NULL")
if grep -q '"deleted"' "$D/c1" && grep -q '"replay"' "$D/c2" && [ "$N" = 2 ]; then echo "PASSOU: corrida 2 conexões — 1 exclusão, 2ª replay"; else echo "FALHOU: corrida $N $(cat "$D/c1" "$D/c2")"; exit 1; fi

# Edição pelo site segurando a linha durante a exclusão: lote espera o lock e vê updated_at novo → changed.
"${P[@]}" -c "INSERT INTO public.gastos(id,user_id,descricao,valor,data,forma_pagamento) VALUES ('e0000000-0000-0000-0000-000000000003','$U','z',3,'2026-06-01','pix');"
CALL6="SET ROLE service_role; SELECT public.wa_lote_mes_excluir('$U','44444444-0000-0000-0000-000000000006','gastos',2026,6,ARRAY['e0000000-0000-0000-0000-000000000003'::uuid],(SELECT array_agg(updated_at) FROM public.gastos WHERE id='e0000000-0000-0000-0000-000000000003'));"
( "${P[@]}" -c "BEGIN; UPDATE public.gastos SET valor=4, updated_at=clock_timestamp() WHERE id='e0000000-0000-0000-0000-000000000003'; SELECT pg_sleep(1.5); COMMIT;" >/dev/null ) &
sleep 0.4
O6=$("${P[@]}" -tAc "$CALL6" 2>&1)
wait
A6=$("${P[@]}" -tAc "SELECT deleted_at IS NULL FROM public.gastos WHERE id='e0000000-0000-0000-0000-000000000003'")
if echo "$O6" | grep -q '"changed"' && [ "$A6" = t ]; then echo "PASSOU: edição concorrente do site → changed, nada excluído"; else echo "FALHOU: concorrência site $O6 $A6"; exit 1; fi
