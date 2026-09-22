import { supabase } from "@/integrations/supabase/client";
import {
  encryptSecret,
  decryptSecret,
  createMasterKey,
  keyMatchesVaultSettings,
  type EntrySecret,
} from "./crypto";
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
  if (data === null) return null;
  const row = data as VaultSettingsRow | undefined;
  if (!row || row.user_id !== userId || !row.salt || !row.verifier || !row.verifier_iv ||
      !Number.isInteger(row.iterations) || row.iterations <= 0) {
    throw new Error("Não foi possível determinar a configuração do Cofre.");
  }
  return row;
}

export async function createVaultSettings(
  row: Omit<VaultSettingsRow, "hint"> & { hint?: string | null },
) {
  // INSERT + user_id primary key rejects concurrent/existing setup atomically.
  // The existing INSERT RLS policy requires auth.uid() = user_id.
  const { error } = await supabase.from("vault_settings" as never).insert(row as never);
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

/** Fresh verification prevents a pre-rotation PIN/native/WebAuthn envelope from
 * restoring the replaced key, including envelopes on another device. */
export async function assertCurrentVaultKey(userId: string, key: CryptoKey) {
  const settings = await fetchVaultSettings(userId);
  if (!settings || !(await keyMatchesVaultSettings(key, settings)))
    throw new Error(
      "A chave do Cofre mudou. Use a senha mestra atual e configure o desbloqueio rápido novamente.",
    );
  return settings;
}

function rotationSettings(settings: VaultSettingsRow) {
  return {
    salt: settings.salt,
    iterations: settings.iterations,
    verifier: settings.verifier,
    verifier_iv: settings.verifier_iv,
    hint: settings.hint ?? null,
  };
}

/** Prepare locally; persist in ONE PostgreSQL transaction. Never fall back to
 * individual writes if the RPC is unavailable. */
export async function rotateMasterKey(args: {
  userId: string;
  currentKey: CryptoKey;
  currentSettings: VaultSettingsRow;
  newPassword: string;
  hint?: string | null;
}): Promise<VaultSettingsRow> {
  if (
    args.currentSettings.user_id !== args.userId ||
    !(await keyMatchesVaultSettings(args.currentKey, args.currentSettings))
  )
    throw new Error("Desbloqueie o Cofre com a senha mestra atual antes de tentar novamente.");
  const rows = await fetchEntries(args.userId);
  const built = await createMasterKey(args.newPassword);
  const entries = [];
  for (const row of rows) {
    const secret = await decryptSecret(args.currentKey, row);
    entries.push({
      id: row.id,
      expected: {
        username_cipher: row.username_cipher,
        password_cipher: row.password_cipher,
        notes_cipher: row.notes_cipher,
        cipher_iv: row.cipher_iv,
        updated_at: row.updated_at,
      },
      replacement: await encryptSecret(built.key, secret),
    });
  }
  const next: VaultSettingsRow = {
    user_id: args.userId,
    salt: built.salt,
    iterations: built.iterations,
    verifier: built.verifier,
    verifier_iv: built.verifier_iv,
    hint: args.hint ?? null,
  };
  let committed: VaultSettingsRow | null = null;
  try {
    const { data, error } = await supabase.rpc(
      "vault_rotate_master_key_atomic" as never,
      {
        p_expected_settings: rotationSettings(args.currentSettings),
        p_new_settings: rotationSettings(next),
        p_entries: entries,
      } as never,
    );
    if (!error && data) committed = data as unknown as VaultSettingsRow;
  } catch {
    // The response may be lost AFTER commit. Reconcile by the prepared generation.
  }
  if (!committed) {
    let current: VaultSettingsRow | null = null;
    try {
      current = await fetchVaultSettings(args.userId);
    } catch {
      /* outcome unknown */
    }
    if (current?.salt === next.salt && current.verifier === next.verifier) committed = current;
    else
      throw new Error(
        "Não foi possível confirmar a troca. Reabra o Cofre com a senha atual; se a nova senha já estiver ativa, use-a. Nenhuma gravação parcial é feita. Se o Cofre mudou em outro dispositivo, tente novamente após recarregar.",
      );
  }
  if (
    committed.user_id !== args.userId ||
    committed.salt !== next.salt ||
    committed.verifier !== next.verifier
  )
    throw new Error(
      "A confirmação da troca não corresponde a este Cofre. Reabra com a senha atual.",
    );
  return committed;
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
