import { supabase } from "@/integrations/supabase/client";
import type { VaultStore, Vault, Slot, EntryRow } from "./service";

// Tabelas novas ainda podem não estar no tipo gerado em todos os ambientes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const must = <T>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

export function supabaseVaultStore(userId: string): VaultStore {
  return {
    async passwordAttempt(vaultId) {
      return must(await db.rpc("vault_v2_password_attempt", { p_vault: vaultId })) as Slot;
    },
    async replacePassword(vaultId, expected, envelope, recoveryGrant) {
      must(
        await db.rpc("vault_v2_password_replace", {
          p_vault: vaultId,
          p_expected: expected,
          p_envelope: envelope,
          p_grant: recoveryGrant ?? null,
        }),
      );
    },
    async getVault() {
      return must(
        await db.from("vaults").select("*").eq("user_id", userId).maybeSingle(),
      ) as Vault | null;
    },
    async createVault() {
      return must(
        await db.from("vaults").insert({ user_id: userId }).select("*").single(),
      ) as Vault;
    },
    async listSlots(vaultId) {
      return must(
        await db.from("vault_keyslots").select("*").eq("vault_id", vaultId).order("created_at"),
      ) as Slot[];
    },
    async insertSlots(rows) {
      must(await db.from("vault_keyslots").insert(rows.map((r) => ({ ...r, user_id: userId }))));
    },
    async updateSlot(id, patch) {
      must(await db.from("vault_keyslots").update(patch).eq("id", id).eq("user_id", userId));
    },
    async listEntries(vaultId) {
      return must(
        await db
          .from("vault_v2_entries")
          .select("*")
          .eq("vault_id", vaultId)
          .order("updated_at", { ascending: false }),
      ) as EntryRow[];
    },
    async insertEntry(vaultId, iv, ciphertext) {
      return must(
        await db
          .from("vault_v2_entries")
          .insert({ vault_id: vaultId, user_id: userId, iv, ciphertext })
          .select("*")
          .single(),
      ) as EntryRow;
    },
    async updateEntry(id, iv, ciphertext) {
      must(
        await db
          .from("vault_v2_entries")
          .update({ iv, ciphertext, updated_at: new Date().toISOString() })
          .eq("id", id)
          .eq("user_id", userId),
      );
    },
    async deleteEntry(id) {
      must(await db.from("vault_v2_entries").delete().eq("id", id).eq("user_id", userId));
    },
    async logEvent(vaultId, event, device) {
      await db
        .from("vault_security_events")
        .insert({ vault_id: vaultId, user_id: userId, event, device_label: device });
    },
  };
}

/** Só conta os registros do cofre anterior; nunca altera. */
export async function legacyEntryCount(userId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("vault_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return error ? null : (count ?? 0);
}
