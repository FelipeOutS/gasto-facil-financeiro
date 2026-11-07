import { runReorganization, type ReorganizationInput } from "../src/server/whatsapp-reorganizacao.server";
import { createReorganizationStore } from "../src/server/whatsapp-reorganizacao-store.server";
// LOCAL DISPOSABLE DATABASE ONLY. Socket path supplied by isolated shell harness.
if (!process.env.PGHOST?.startsWith("/tmp/gi-pg-reorganization.")) throw Error("isolated_database_required");

const signatures: Record<string, string[]> = {
  wa_reorganization_authorized: ["p_user", "p_phone"],
  wa_reorganization_prepare_v2: ["p_user", "p_phone", "p_request", "p_scope", "p_income", "p_code", "p_balance"],
  wa_reorganization_confirm_v2: ["p_user", "p_phone", "p_code", "p_operation"],
  wa_reorganization_control: ["p_user", "p_phone", "p_action"],
  wa_reorganization_restore_prepare: ["p_user", "p_phone", "p_operation", "p_code"],
  wa_reorganization_last_applied: ["p_user", "p_phone"],
  wa_full_reset_prepare: ["p_user", "p_phone", "p_request", "p_code"],
  wa_full_reset_confirm: ["p_user", "p_phone", "p_code", "p_operation"],
  wa_full_reset_restore_prepare: ["p_user", "p_phone", "p_operation", "p_code"],
  wa_full_reset_restore_confirm: ["p_user", "p_phone", "p_operation", "p_code"],
  wa_full_reset_last_applied: ["p_user", "p_phone"],
};
const sqlValue = (v: unknown) => (v == null ? "NULL" : `'${(typeof v === "object" ? JSON.stringify(v) : String(v)).replaceAll("'", "''")}'`);
async function psql(sql: string): Promise<string> {
  const cmd = Bun.spawn(["psql", "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(cmd.stdout).text();
  const err = await new Response(cmd.stderr).text();
  if ((await cmd.exited) !== 0) throw Error(err);
  return out.trim();
}
const store = createReorganizationStore(
  {
    rpc: async (name, args) => {
      const keys = signatures[name];
      if (!keys) throw Error(`unknown_rpc:${name}`);
      try {
        const out = await psql(`SELECT public.${name}(${keys.map((k) => sqlValue(args[k])).join(",")});`);
        if (out === "t" || out === "f") return { data: out === "t", error: null };
        if (out === "") return { data: null, error: null };
        try { return { data: JSON.parse(out), error: null }; } catch { return { data: out, error: null }; }
      } catch (e) {
        return { data: null, error: { message: String(e) } };
      }
    },
  },
  { fullReset: true },
);

const U = "aaaaaaaa-0000-0000-0000-000000000001";
await psql(`UPDATE public.whatsapp_reorganization_policy SET release_enabled=true; INSERT INTO public.whatsapp_reorganization_allowlist(user_id) VALUES ('${U}') ON CONFLICT DO NOTHING;`);
const active = () => psql(`SELECT (SELECT count(*) FROM gastos WHERE user_id='${U}' AND deleted_at IS NULL)||'/'||(SELECT count(*) FROM receitas WHERE user_id='${U}' AND deleted_at IS NULL)||'/'||(SELECT count(*) FROM faturas_cartao WHERE user_id='${U}' AND reorg_archived_at IS NULL)||'/'||(SELECT count(*) FROM recorrencias WHERE user_id='${U}' AND status='ativa')`);
const before = await active();
const spoken = (code: string) => code.split("").map((d) => ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"][Number(d)]).join(" ");
const input: ReorganizationInput = { userId: U, phone: "5511999999999", externalId: "voice-full-1", localDate: "2030-02-03", pendingSession: false,
  text: "GI, exclua todos os meus gastos, receitas e lançamentos financeiros. Quero zerar tudo." };

const preview = await runReorganization(input, store);
const code = preview?.match(/APAGAR [\da-f-]{36} (\d{6})/i)?.[1];
if (!code || !preview?.includes("Inclui:") || !preview.includes("fatura")) throw Error(`preview_failed:${preview}`);
if (!preview.includes("Limpeza total do histórico") && !preview.includes("NÃO zera")) throw Error("preview_missing_completeness");
if ((await active()) !== before) throw Error("preview_wrote");
console.log("PASS: voice: full preview lists card/invoice/installment/recurring/import blocks, writes nothing");

const wrong = await runReorganization({ ...input, externalId: "voice-full-wrong", text: `apagar ${spoken(code === "000000" ? "111111" : "000000")}` }, store);
if (!wrong?.includes("Código inválido")) throw Error(`wrong_code_failed:${wrong}`);
const applied = await runReorganization({ ...input, externalId: "voice-full-confirm", text: `apagar ${spoken(code)}` }, store);
if (!applied?.match(/Reorganização (concluída|aplicada parcialmente)/)) throw Error(`apply_failed:${applied}`);
const after = await active();
if (!after.startsWith("0/0/0/0") && !applied.includes("PARCIAL")) throw Error(`apply_left_rows_without_partial_label:${after}`);
console.log(`PASS: voice: spoken six-digit code applied (${before} → ${after})`);

const again = await runReorganization({ ...input, externalId: "voice-full-again", text: `apagar ${spoken(code)}` }, store);
if (!again?.includes("já foi concluída") && !again?.includes("Código inválido")) throw Error(`replay_failed:${again}`);
if ((await active()) !== after) throw Error("replay_changed_data");
console.log("PASS: voice: repeated confirmation changes nothing");

const restorePreview = await runReorganization({ ...input, externalId: "voice-full-restore", text: "restaurar última limpeza" }, store);
const rcode = restorePreview?.match(/RESTAURAR [\da-f-]{36} (\d{6})/i)?.[1];
if (!rcode) throw Error(`restore_preview_failed:${restorePreview}`);
const restored = await runReorganization({ ...input, externalId: "voice-full-restore-ok", text: `restaurar ${spoken(rcode)}` }, store);
if (!restored?.includes("Restauração concluída")) throw Error(`restore_failed:${restored}`);
if ((await active()) !== before) throw Error(`restore_mismatch:${before} vs ${await active()}`);
const replayRestore = await runReorganization({ ...input, externalId: "voice-full-restore-again", text: `restaurar ${spoken(rcode)}` }, store);
if ((await active()) !== before) throw Error("restore_replay_duplicated");
console.log(`PASS: voice: "restaurar última limpeza" + spoken code restored everything (${await active()}); replay safe (${replayRestore?.slice(0, 30)}…)`);

await psql(`DELETE FROM public.whatsapp_reorganization_allowlist; UPDATE public.whatsapp_reorganization_policy SET release_enabled=false;`);
