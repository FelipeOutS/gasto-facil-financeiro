import { supabase } from "@/integrations/supabase/client";
import {
  encryptSecret,
  decryptSecret,
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
  return (data as VaultSettingsRow | null) ?? null;
}

export async function saveVaultSettings(row: Omit<VaultSettingsRow, "hint"> & { hint?: string | null }) {
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
      password_updated_at: changedPwd
        ? new Date().toISOString()
        : undefined,
      ...enc,
    } as never)
    .eq("id", input.id);
  if (error) throw error;
}

export async function deleteEntry(id: string) {
  const { error } = await supabase.from("vault_entries" as never).delete().eq("id", id);
  if (error) throw error;
}

export async function decryptOne(key: CryptoKey, row: VaultEntryRow): Promise<DecryptedEntry> {
  return { ...row, secret: await decryptSecret(key, row) };
}
