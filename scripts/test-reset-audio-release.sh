#!/usr/bin/env bash
# Banco temporário descartável: aplica o pacote único, confere travas, reverte.
set -euo pipefail
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE DATABASE_URL || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gi-pg-release.XXXX)"; chmod 777 "$D"
RUN=(); [ "$(id -u)" = 0 ] && RUN=(setpriv --reuid=1000 --regid=1000 --clear-groups)
"${RUN[@]}" initdb -D "$D/data" -U gi_test --auth=trust >/dev/null
"${RUN[@]}" pg_ctl -D "$D/data" -o "-k $D -p 55461 -c listen_addresses=''" -l "$D/log" start >/dev/null
trap '"${RUN[@]}" pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p 55461 -U gi_test -d postgres)
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-reorganizacao/00-stub.sql"
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-reorganizacao/05-account-card-stub.sql"
"${P[@]}" -f "$ROOT/tests/sql/whatsapp-reorganizacao/140-full-reset-stub.sql"
"${P[@]}" -tAc "CREATE TABLE trig_base AS SELECT tgrelid::regclass::text t, tgname FROM pg_trigger WHERE NOT tgisinternal"
"${P[@]}" -f "$ROOT/docs/release/reset-audio-preflight.sql"
"${P[@]}" -1 -f "$ROOT/docs/release/reset-audio-combined.sql" && echo "PASS: release: combined package applies in one transaction"
"${P[@]}" -f "$ROOT/docs/release/reset-audio-postcheck.sql"
# Uso normal com tudo aplicado e desligado.
"${P[@]}" -tAc "INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento) VALUES ('d0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Normal',5,'2030-01-01','pix'); UPDATE gastos SET valor=6 WHERE id='d0000000-0000-0000-0000-000000000001'; DELETE FROM gastos WHERE id='d0000000-0000-0000-0000-000000000001';" && echo "PASS: release: ordinary expense insert/update/delete unaffected"
"${P[@]}" -tAc "SET ROLE service_role; SELECT public.wa_full_reset_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','rel-1','121212')->>'status'" | grep -qx blocked && echo "PASS: release: prepare blocked while release off and allowlist empty"
# Reversão.
"${P[@]}" -1 -f "$ROOT/docs/release/reset-audio-rollback.sql" && echo "PASS: release: rollback applies"
LEFT=$("${P[@]}" -tAc "SELECT count(*) FROM pg_trigger tg WHERE NOT tgisinternal AND NOT EXISTS(SELECT 1 FROM trig_base b WHERE b.t=tg.tgrelid::regclass::text AND b.tgname=tg.tgname)")
[ "$LEFT" = 0 ] && echo "PASS: release: rollback removed every new trigger" || { echo "FAIL: $LEFT triggers left"; "${P[@]}" -tAc "SELECT tgrelid::regclass, tgname FROM pg_trigger tg WHERE NOT tgisinternal AND NOT EXISTS(SELECT 1 FROM trig_base b WHERE b.t=tg.tgrelid::regclass::text AND b.tgname=tg.tgname)"; exit 1; }
"${P[@]}" -tAc "SET ROLE service_role; SELECT public.wa_full_reset_prepare('aaaaaaaa-0000-0000-0000-000000000001','5511999999999','rel-2','131313')" >/dev/null 2>&1 && { echo "FAIL: function still callable"; exit 1; } || echo "PASS: release: cleanup RPCs no longer callable after rollback"
"${P[@]}" -tAc "INSERT INTO gastos(id,user_id,descricao,valor,data,forma_pagamento) VALUES ('d0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Depois',5,'2030-01-01','pix'); DELETE FROM gastos WHERE id='d0000000-0000-0000-0000-000000000002';" && echo "PASS: release: ordinary use after rollback"
