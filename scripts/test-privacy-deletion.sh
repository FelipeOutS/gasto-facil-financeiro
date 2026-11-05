#!/usr/bin/env bash
# Banco temporário descartável: reproduz a falha da exclusão LGPD e testa o candidato.
set -euo pipefail
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE DATABASE_URL SUPABASE_DB_URL || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gi-pg-privacy.XXXX)"; chmod 777 "$D"
RUN=(); [ "$(id -u)" = 0 ] && RUN=(setpriv --reuid=1000 --regid=1000 --clear-groups)
"${RUN[@]}" initdb -D "$D/data" -U gi_test --auth=trust >/dev/null
"${RUN[@]}" pg_ctl -D "$D/data" -o "-k $D -p 55471 -c listen_addresses=''" -l "$D/log" start >/dev/null
trap '"${RUN[@]}" pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p 55471 -U gi_test -d postgres)
Q() { "${P[@]}" -tAc "$1" 2>&1 || true; }
pass() { echo "PASS: $1"; }; fail() { echo "FAIL: $1"; exit 1; }
A=aaaaaaaa-0000-0000-0000-000000000001; B=bbbbbbbb-0000-0000-0000-000000000002
"${P[@]}" -f "$ROOT/tests/sql/privacy-deletion/00-stub.sql"
"${P[@]}" -f "$ROOT/tests/sql/privacy-deletion/00-current-production-function.sql"
"${P[@]}" -f "$ROOT/tests/sql/privacy-deletion/10-tests.sql"
AS_A="SET request.jwt.claim.sub='$A'; SET ROLE authenticated;"

# --- Função atual (cópia exata da produção) ---
OUT=$(Q "$AS_A SELECT public.execute_data_deletion_atomic('$A', ARRAY['market','imports'], '{}')")
echo "$OUT" | grep -q "pluggy_import_entries_batch_id_fkey" && pass "atual: imports com Pluggy falha por FK RESTRICT (causa reproduzida)" || fail "atual: esperado erro de FK, veio: $OUT"
[ "$(Q 'SELECT same()')" = t ] && pass "atual: falha reverte tudo (market não foi apagado parcialmente)" || fail "atual: exclusão parcial"
OUT=$(Q "BEGIN; SET ROLE anon; SELECT public.execute_data_deletion_atomic('$B', ARRAY['market'], '{}'); ROLLBACK;")
echo "$OUT" | grep -q "{\"market\"" && pass "atual: VULNERABILIDADE reproduzida — anon sem login apaga dados de outro usuário (revertido no teste)" || echo "INFO: anon atual -> $OUT"

# --- Candidato ---
"${P[@]}" -1 -f "$ROOT/docs/migrations-candidate/privacy-deletion-hardening.sql" && pass "candidato aplica em uma transação"
OUT=$(Q "SET ROLE anon; SELECT public.execute_data_deletion_atomic('$B', ARRAY['market'], '{}')")
echo "$OUT" | grep -qi "permission denied" && pass "candidato: anon não pode executar" || fail "candidato: anon -> $OUT"
OUT=$(Q "SET ROLE service_role; SELECT public.execute_data_deletion_atomic('$B', ARRAY['market'], '{}')")
echo "$OUT" | grep -q "not_authorized" && pass "candidato: service role sem login do usuário é recusado" || fail "candidato: service -> $OUT"
OUT=$(Q "$AS_A SELECT public.execute_data_deletion_atomic('$B', ARRAY['market'], '{}')")
echo "$OUT" | grep -q "not_authorized" && pass "candidato: usuário não apaga dados de terceiro" || fail "candidato: terceiro -> $OUT"
OUT=$(Q "$AS_A SELECT public.execute_data_deletion_atomic('$A', ARRAY['payables'], '{\"payables\":{\"scope\":\"tudo\"}}')")
echo "$OUT" | grep -q "invalid_selection" && pass "candidato: escopo desconhecido recusado" || fail "candidato: escopo -> $OUT"
OUT=$(Q "$AS_A SELECT public.execute_data_deletion_atomic('$A', ARRAY['market','imports'], '{}')")
echo "$OUT" | grep -q "blocked_by_dependencies" && pass "candidato: imports com Pluggy bloqueado com código claro" || fail "candidato: imports -> $OUT"
[ "$(Q 'SELECT same()')" = t ] && pass "candidato: bloqueio não apaga nada" || fail "candidato: exclusão parcial"
"${P[@]}" -tAc "INSERT INTO cartoes VALUES ('ca000000-0000-0000-0000-000000000001','$A'); INSERT INTO gastos(id,user_id,cartao_id) VALUES ('d0000000-0000-0000-0000-000000000001','$A','ca000000-0000-0000-0000-000000000001')"
OUT=$(Q "$AS_A SELECT public.execute_data_deletion_atomic('$A', ARRAY['cards'], '{}')")
echo "$OUT" | grep -q "blocked_by_dependencies" && pass "candidato: cartão com compras bloqueado (não desvincula)" || fail "candidato: cards -> $OUT"
[ "$(Q "SELECT cartao_id IS NOT NULL FROM gastos WHERE id='d0000000-0000-0000-0000-000000000001'")" = t ] && pass "candidato: vínculo do gasto ao cartão preservado" || fail "vínculo perdido"
OUT=$(Q "$AS_A SELECT public.execute_data_deletion_atomic('$A', ARRAY['market'], '{}')")
echo "$OUT" | grep -q '"market": 1' && pass "candidato: categoria sem vínculo é excluída e confirmada" || fail "candidato: market -> $OUT"
[ "$(Q "SELECT count(*) FROM mercado_listas WHERE user_id='$B'")" = 1 ] && pass "candidato: dados do terceiro intactos" || fail "terceiro afetado"
[ "$(Q "SELECT count(*) FROM imported_transactions")" = 756 ] && pass "candidato: importações intactas" || fail "importações alteradas"
[ "$(Q "SELECT count(*) FROM audit_logs WHERE action='selective_data_deletion_atomic'")" = 1 ] && pass "candidato: auditoria registrada só no sucesso" || fail "auditoria"
