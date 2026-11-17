// Cofre v2: regras de configuração, desbloqueio, recuperação e revogação.
// O armazenamento é injetado (Supabase no app, memória nos testes).
// Nunca toca vault_entries / vault_settings / vault_pin_settings.
import {
  generateDek, wrapDek, unwrapDek, generateRecoveryKey, recoveryMaterial,
  encryptEntry, decryptEntry, type Envelope, type SlotKind,
} from "./keyslots";

type Bytes = Uint8Array<ArrayBuffer>;
export type Vault = { id: string; user_id: string; name: string; auto_lock_minutes: number };
export type Slot = {
  id: string; vault_id: string; user_id: string; kind: SlotKind; credential_id: string | null;
  prf_salt: string | null; device_label: string | null; envelope: Envelope | { revoked: true };
  revoked_at: string | null; last_used_at: string | null; created_at: string;
};
export type EntryRow = { id: string; vault_id: string; iv: string; ciphertext: string; created_at: string; updated_at: string };
export type Secret = { title: string; username: string; password: string; url: string; category: string; notes: string };

export interface VaultStore {
  getVault(): Promise<Vault | null>;
  createVault(): Promise<Vault>;
  listSlots(vaultId: string): Promise<Slot[]>;
  insertSlots(rows: Omit<Slot, "id" | "created_at" | "revoked_at" | "last_used_at" | "user_id">[]): Promise<void>;
  updateSlot(id: string, patch: Partial<Slot>): Promise<void>;
  listEntries(vaultId: string): Promise<EntryRow[]>;
  insertEntry(vaultId: string, iv: string, ct: string): Promise<EntryRow>;
  updateEntry(id: string, iv: string, ct: string): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  logEvent(vaultId: string, event: string, device: string | null): Promise<void>;
}

const active = (s: Slot) => !s.revoked_at && "ct" in s.envelope;
export const activeSlots = (slots: Slot[]) => slots.filter(active);
/** Configurado = existe ao menos um slot ativo de recuperação (validado antes de gravar). */
export const isConfigured = (slots: Slot[]) => activeSlots(slots).some((s) => s.kind === "recovery");

export type PasskeyMaterial = { credentialId: string; prfSalt: string; prf: Bytes; label: string };

/** Configuração inicial: só grava depois de provar que DEK abre com cada material. */
export async function setupVault(store: VaultStore, passkey: PasskeyMaterial | null) {
  const vault = (await store.getVault()) ?? (await store.createVault());
  if (isConfigured(await store.listSlots(vault.id))) throw new Error("ja_configurado");
  const dek = await generateDek();
  const recoveryKey = generateRecoveryKey();
  const recEnv = await wrapDek(dek, recoveryMaterial(recoveryKey), "recovery");
  const probe = await encryptEntry(dek, "probe");
  if ((await decryptEntry(await unwrapDek(recEnv, recoveryMaterial(recoveryKey)), probe)) !== "probe") throw new Error("validacao_falhou");
  const rows: Parameters<VaultStore["insertSlots"]>[0] = [
    { vault_id: vault.id, kind: "recovery", credential_id: null, prf_salt: null, device_label: "Chave de recuperação", envelope: recEnv },
  ];
  if (passkey) {
    const env = await wrapDek(dek, passkey.prf, "passkey_prf");
    if ((await decryptEntry(await unwrapDek(env, passkey.prf), probe)) !== "probe") throw new Error("validacao_falhou");
    rows.push({ vault_id: vault.id, kind: "passkey_prf", credential_id: passkey.credentialId, prf_salt: passkey.prfSalt, device_label: passkey.label, envelope: env });
  }
  return {
    vault, recoveryKey, dek,
    /** Chamado só após o usuário confirmar que guardou a chave. */
    commit: async () => {
      await store.insertSlots(rows);
      await store.logEvent(vault.id, passkey ? "setup_passkey_recovery" : "setup_recovery_only", passkey?.label ?? null);
    },
  };
}

export async function unlockWithPasskey(store: VaultStore, vault: Vault, got: { credentialId: string; prf: Bytes }, label: string) {
  const slot = activeSlots(await store.listSlots(vault.id)).find((s) => s.kind === "passkey_prf" && s.credential_id === got.credentialId);
  if (!slot) throw new Error("aparelho_nao_autorizado");
  try {
    const dek = await unwrapDek(slot.envelope as Envelope, got.prf, true);
    await store.updateSlot(slot.id, { last_used_at: new Date().toISOString() });
    await store.logEvent(vault.id, "unlock_passkey", label);
    return dek;
  } catch {
    await store.logEvent(vault.id, "unlock_failed", label);
    throw new Error("chave_invalida");
  }
}

export async function unlockWithRecovery(store: VaultStore, vault: Vault, key: string, label: string) {
  const slot = activeSlots(await store.listSlots(vault.id)).find((s) => s.kind === "recovery");
  if (!slot) throw new Error("sem_recuperacao");
  try {
    const dek = await unwrapDek(slot.envelope as Envelope, recoveryMaterial(key), true);
    await store.logEvent(vault.id, "unlock_recovery", label);
    return dek;
  } catch {
    await store.logEvent(vault.id, "unlock_failed", label);
    throw new Error("chave_invalida");
  }
}

/** Autoriza um novo aparelho; precisa do cofre aberto (DEK em memória). DEK é exportável só aqui. */
export async function addPasskey(store: VaultStore, vault: Vault, dek: CryptoKey, p: PasskeyMaterial) {
  const env = await wrapDek(dek, p.prf, "passkey_prf");
  await unwrapDek(env, p.prf);
  await store.insertSlots([{ vault_id: vault.id, kind: "passkey_prf", credential_id: p.credentialId, prf_salt: p.prfSalt, device_label: p.label, envelope: env }]);
  await store.logEvent(vault.id, "device_added", p.label);
}

/** Revoga: apaga o envelope do servidor, então o aparelho não consegue mais abrir. */
export async function revokeSlot(store: VaultStore, vault: Vault, slot: Slot) {
  const left = activeSlots(await store.listSlots(vault.id)).filter((s) => s.id !== slot.id);
  if (!left.some((s) => s.kind === "recovery")) throw new Error("manter_recuperacao");
  await store.updateSlot(slot.id, { revoked_at: new Date().toISOString(), envelope: { revoked: true } });
  await store.logEvent(vault.id, "device_revoked", slot.device_label);
}

/** Gera nova chave de recuperação (a antiga deixa de funcionar). */
export async function rotateRecovery(store: VaultStore, vault: Vault, dek: CryptoKey) {
  const key = generateRecoveryKey();
  const env = await wrapDek(dek, recoveryMaterial(key), "recovery");
  await unwrapDek(env, recoveryMaterial(key));
  const old = activeSlots(await store.listSlots(vault.id)).filter((s) => s.kind === "recovery");
  return {
    key,
    commit: async () => {
      await store.insertSlots([{ vault_id: vault.id, kind: "recovery", credential_id: null, prf_salt: null, device_label: "Chave de recuperação", envelope: env }]);
      for (const s of old) await store.updateSlot(s.id, { revoked_at: new Date().toISOString(), envelope: { revoked: true } });
      await store.logEvent(vault.id, "recovery_rotated", null);
    },
  };
}

export async function readEntries(store: VaultStore, vault: Vault, dek: CryptoKey) {
  const rows = await store.listEntries(vault.id);
  return Promise.all(rows.map(async (r) => ({ id: r.id, updated_at: r.updated_at, secret: JSON.parse(await decryptEntry(dek, { iv: r.iv, ct: r.ciphertext })) as Secret })));
}
export async function saveEntry(store: VaultStore, vault: Vault, dek: CryptoKey, s: Secret, id?: string) {
  const { iv, ct } = await encryptEntry(dek, JSON.stringify(s));
  if (id) await store.updateEntry(id, iv, ct);
  else await store.insertEntry(vault.id, iv, ct);
}
