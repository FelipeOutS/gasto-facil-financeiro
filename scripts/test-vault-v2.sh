#!/usr/bin/env bash
# Banco descartável: valida o candidato do Cofre v2 (isolamento, cofre antigo intacto).
set -euo pipefail
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE DATABASE_URL SUPABASE_DB_URL || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gi-pg-vault.XXXX)"; chmod 777 "$D"
RUN=(); [ "$(id -u)" = 0 ] && RUN=(setpriv --reuid=1000 --regid=1000 --clear-groups)
"${RUN[@]}" initdb -D "$D/data" -U gi_test --auth=trust >/dev/null
"${RUN[@]}" pg_ctl -D "$D/data" -o "-k $D -p 55472 -c listen_addresses=''" -l "$D/log" start >/dev/null
trap '"${RUN[@]}" pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p 55472 -U gi_test -d postgres)
Q() { "${P[@]}" -tAc "$1" 2>&1 || true; }
ok() { echo "PASS: $1"; }; no() { echo "FAIL: $1"; exit 1; }
A=aaaaaaaa-0000-0000-0000-000000000001; B=bbbbbbbb-0000-0000-0000-000000000002
"${P[@]}" -f "$ROOT/tests/sql/vault-v2/00-stub.sql"
FP="SELECT md5(string_agg(id::text||ciphertext,',' ORDER BY id)) FROM vault_entries"
BEFORE=$(Q "$FP")
"${P[@]}" -1 -f "$ROOT/docs/migrations-candidate/vault-v2-passwordless.sql" && ok "candidato aplica em uma transação"
AS() { echo "SET request.jwt.claim.sub='$1'; SET ROLE authenticated;"; }
VA=$(Q "$(AS $A) INSERT INTO vaults(user_id) VALUES ('$A') RETURNING id" | head -1)
VB=$(Q "$(AS $B) INSERT INTO vaults(user_id) VALUES ('$B') RETURNING id" | head -1)
[[ $VA =~ ^[0-9a-f-]{36}$ && $VB =~ ^[0-9a-f-]{36}$ ]] && ok "cada usuário cria o próprio cofre" || no "criar cofre: $VA / $VB"
echo "$(Q "$(AS $A) INSERT INTO vaults(user_id) VALUES ('$A')")" | grep -q duplicate && ok "um cofre por usuário" || no "segundo cofre"
echo "$(Q "$(AS $A) INSERT INTO vaults(user_id) VALUES ('$B')")" | grep -qi "row-level" && ok "não cria cofre em nome de outro" || no "cofre alheio"
Q "$(AS $A) INSERT INTO vault_keyslots(vault_id,user_id,kind,envelope) VALUES ('$VA','$A','recovery','{}'); INSERT INTO vault_v2_entries(vault_id,user_id,iv,ciphertext) VALUES ('$VA','$A','iv','ct')" >/dev/null
[ "$(Q "$(AS $B) SELECT count(*) FROM vault_v2_entries")" = 0 ] && [ "$(Q "$(AS $B) SELECT count(*) FROM vault_keyslots")" = 0 ] && ok "B não lê registros nem chaves de A" || no "vazamento"
echo "$(Q "$(AS $B) INSERT INTO vault_v2_entries(vault_id,user_id,iv,ciphertext) VALUES ('$VA','$B','i','c')")" | grep -qi "row-level" && ok "B não grava no cofre de A" || no "escrita alheia"
echo "$(Q "$(AS $A) UPDATE vault_keyslots SET vault_id='$VB'")" | grep -qi "row-level" && ok "chave não pode ser movida para cofre alheio" || no "mover chave"
[ "$(Q "SET ROLE anon; SELECT count(*) FROM vaults" | grep -c 'permission denied')" = 1 ] && ok "sem login não acessa" || no "anon"
echo "$(Q "$(AS $A) DELETE FROM vault_keyslots")" | grep -qi "permission denied" && ok "chaves não são apagadas (só revogadas)" || no "delete chave"
echo "$(Q "DELETE FROM vaults WHERE id='$VA'")" | grep -qi "foreign key" && ok "apagar cofre não leva registros em cascata" || no "cascata"
[ "$(Q "$(AS $A) SELECT count(*) FROM vault_entries")" ] && true
[ "$(Q "$FP")" = "$BEFORE" ] && [ "$(Q 'SELECT count(*) FROM vault_entries')" = 14 ] && ok "14 registros antigos idênticos" || no "cofre antigo mudou"
