import { supabase } from "@/integrations/supabase/client";
import { encryptSecret, decryptSecret, createMasterKey, type EntrySecret } from "./crypto";
import { evaluateStrength, type Strength } from "./strength";

export type VaultSettingsRow = {
  user_id: string;
  salt: string;
  verifier: string;
  verifier_iv: string;
  iterations: number;
  hint: string | null;
};

export type VaultEntryRow = {
  id: string;
  user_id: string;
  name: string;
  category: string;
  site: string | null;
  favorite: boolean;
  password_strength: Strength;
  password_updated_at: string | null;
  username_cipher: string | null;
  password_cipher: string | null;
  notes_cipher: string | null;
  cipher_iv: string;
  created_at: string;
  updated_at: string;
};

export type DecryptedEntry = VaultEntryRow & { secret: EntrySecret };

export async function fetchVaultSettings(userId: string): Promise<VaultSettingsRow | null> {
  const { data, error } = await supabase
    .from("vault_settings" as never)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as VaultSettingsRow | null) ?? null;
}

export async function saveVaultSettings(
  row: Omit<VaultSettingsRow, "hint"> & { hint?: string | null },
) {
  const { error } = await supabase.from("vault_settings" as never).upsert(row as never);
  if (error) throw error;
}

export async function fetchEntries(userId: string): Promise<VaultEntryRow[]> {
  const { data, error } = await supabase
    .from("vault_entries" as never)
    .select("*")
    .eq("user_id", userId)
    .order("favorite", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as VaultEntryRow[];
}

export async function createEntry(input: {
  user_id: string;
  name: string;
  category: string;
  site?: string | null;
  favorite?: boolean;
  secret: EntrySecret;
  key: CryptoKey;
}) {
  const enc = await encryptSecret(input.key, input.secret);
  const strength = evaluateStrength(input.secret.password ?? "");
  const { error } = await supabase.from("vault_entries" as never).insert({
    user_id: input.user_id,
    name: input.name,
    category: input.category,
    site: input.site ?? null,
    favorite: input.favorite ?? false,
    password_strength: strength,
    password_updated_at: input.secret.password ? new Date().toISOString() : null,
    ...enc,
  } as never);
  if (error) throw error;
}

export async function updateEntry(input: {
  id: string;
  name: string;
  category: string;
  site?: string | null;
  favorite?: boolean;
  secret: EntrySecret;
  key: CryptoKey;
  previousPassword?: string;
}) {
  const enc = await encryptSecret(input.key, input.secret);
  const strength = evaluateStrength(input.secret.password ?? "");
  const changedPwd = (input.previousPassword ?? "") !== (input.secret.password ?? "");
  const { error } = await supabase
    .from("vault_entries" as never)
    .update({
      name: input.name,
      category: input.category,
      site: input.site ?? null,
      favorite: input.favorite ?? false,
      password_strength: strength,
      password_updated_at: changedPwd ? new Date().toISOString() : undefined,
      ...enc,
    } as never)
    .eq("id", input.id);
  if (error) throw error;
}

export async function deleteEntry(id: string) {
  const { error } = await supabase
    .from("vault_entries" as never)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function decryptOne(key: CryptoKey, row: VaultEntryRow): Promise<DecryptedEntry> {
  return { ...row, secret: await decryptSecret(key, row) };
}

/**
 * Rotaciona a senha mestra: deriva nova key, recriptografa todas as entries
 * e atualiza vault_settings com novo salt/verifier. Operação melhor-esforço:
 * recriptografia ocorre antes do update do verifier para minimizar risco de
 * inconsistência (entries com key nova continuam funcionando com nova senha).
 */
export async function rotateMasterKey(args: {
  userId: string;
  currentKey: CryptoKey;
  newPassword: string;
  hint?: string | null;
}): Promise<void> {
  const rows = await fetchEntries(args.userId);
  // Decifra tudo com a key atual
  const decrypted: { id: string; secret: EntrySecret }[] = [];
  for (const r of rows) {
    decrypted.push({ id: r.id, secret: await decryptSecret(args.currentKey, r) });
  }
  // Cria nova master key
  const built = await createMasterKey(args.newPassword);
  // Recriptografa cada entry com a nova key
  for (const d of decrypted) {
    const enc = await encryptSecret(built.key, d.secret);
    const { error } = await supabase
      .from("vault_entries" as never)
      .update({ ...enc } as never)
      .eq("id", d.id);
    if (error) throw error;
  }
  // Atualiza settings (verifier) por último
  await saveVaultSettings({
    user_id: args.userId,
    salt: built.salt,
    verifier: built.verifier,
    verifier_iv: built.verifier_iv,
    iterations: built.iterations,
    hint: args.hint ?? null,
  });
  return;
}

/**
 * Gera um backup JSON com os dados JÁ criptografados (sem a senha mestra).
 * O backup só pode ser restaurado com a senha mestra correta no futuro.
 */
export async function buildEncryptedBackup(args: {
  userId: string;
  settings: VaultSettingsRow;
}): Promise<string> {
  const rows = await fetchEntries(args.userId);
  const payload = {
    format: "gasto-inteligente.vault.v1",
    exported_at: new Date().toISOString(),
    settings: {
      salt: args.settings.salt,
      verifier: args.settings.verifier,
      verifier_iv: args.settings.verifier_iv,
      iterations: args.settings.iterations,
      hint: args.settings.hint,
    },
    entries: rows.map((r) => ({
      name: r.name,
      category: r.category,
      site: r.site,
      favorite: r.favorite,
      password_strength: r.password_strength,
      password_updated_at: r.password_updated_at,
      username_cipher: r.username_cipher,
      password_cipher: r.password_cipher,
      notes_cipher: r.notes_cipher,
      cipher_iv: r.cipher_iv,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  };
  return JSON.stringify(payload, null, 2);
}
