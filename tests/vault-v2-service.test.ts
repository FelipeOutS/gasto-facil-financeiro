import { describe, it, expect } from "vitest";
import * as S from "../src/lib/vault/v2/service";
import { randomBytes } from "../src/lib/vault/v2/keyslots";

function memStore(userId = "u1") {
  let vault: S.Vault | null = null;
  const slots: S.Slot[] = []; const entries: S.EntryRow[] = []; const events: string[] = [];
  let n = 0; const id = () => `id${++n}`;
  const store: S.VaultStore = {
    async getVault() { return vault; },
    async createVault() { vault = { id: id(), user_id: userId, name: "Cofre", auto_lock_minutes: 5 }; return vault; },
    async listSlots() { return slots.map((s) => ({ ...s })); },
    async insertSlots(rows) { for (const r of rows) slots.push({ ...r, id: id(), user_id: userId, revoked_at: null, last_used_at: null, created_at: "" }); },
    async updateSlot(i, p) { Object.assign(slots.find((s) => s.id === i)!, p); },
    async listEntries() { return entries; },
    async insertEntry(v, iv, ciphertext) { const r = { id: id(), vault_id: v, iv, ciphertext, created_at: "", updated_at: "" }; entries.push(r); return r; },
    async updateEntry(i, iv, ct) { Object.assign(entries.find((e) => e.id === i)!, { iv, ciphertext: ct }); },
    async deleteEntry(i) { entries.splice(entries.findIndex((e) => e.id === i), 1); },
    async logEvent(_v, e) { events.push(e); },
  };
  return { store, slots, entries, events };
}
const pk = (cid = "cred-mac") => ({ credentialId: cid, prfSalt: "s", prf: randomBytes(32), label: "Mac · Safari" });
const secret: S.Secret = { title: "Banco", username: "felipe", password: "x!9Lk2", url: "", category: "Bancos", notes: "n" };

describe("Cofre v2 — serviço", () => {
  it("configura sem senha mestra e só grava após confirmação da chave de recuperação", async () => {
    const m = memStore(); const p = pk();
    const r = await S.setupVault(m.store, p);
    expect(m.slots.length).toBe(0);
    expect(S.isConfigured(m.slots)).toBe(false);
    await r.commit();
    expect(S.isConfigured(m.slots)).toBe(true);
    expect(r.recoveryKey).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4})+$/);
    expect(JSON.stringify(m.slots)).not.toContain(r.recoveryKey);
  });

  it("grava credencial cifrada e lê de volta com passkey", async () => {
    const m = memStore(); const p = pk();
    const r = await S.setupVault(m.store, p); await r.commit();
    await S.saveEntry(m.store, r.vault, r.dek, secret);
    expect(m.entries[0].ciphertext).not.toContain("felipe");
    const dek = await S.unlockWithPasskey(m.store, r.vault, p, "Mac");
    expect((await S.readEntries(m.store, r.vault, dek))[0].secret).toEqual(secret);
  });

  it("recupera com a chave de recuperação e autoriza um aparelho novo", async () => {
    const m = memStore(); const r = await S.setupVault(m.store, pk()); await r.commit();
    await S.saveEntry(m.store, r.vault, r.dek, secret);
    const dek = await S.unlockWithRecovery(m.store, r.vault, r.recoveryKey.toLowerCase(), "iPhone");
    const iphone = pk("cred-iphone");
    await S.addPasskey(m.store, r.vault, dek, iphone);
    const dek2 = await S.unlockWithPasskey(m.store, r.vault, iphone, "iPhone");
    expect((await S.readEntries(m.store, r.vault, dek2))[0].secret.username).toBe("felipe");
  });

  it("recusa chave de recuperação errada e PRF de outro aparelho, registrando falha", async () => {
    const m = memStore(); const p = pk(); const r = await S.setupVault(m.store, p); await r.commit();
    const wrong = (await S.setupVault(memStore().store, null)).recoveryKey;
    await expect(S.unlockWithRecovery(m.store, r.vault, wrong, "x")).rejects.toThrow("chave_invalida");
    await expect(S.unlockWithPasskey(m.store, r.vault, { credentialId: p.credentialId, prf: randomBytes(32) }, "x")).rejects.toThrow("chave_invalida");
    await expect(S.unlockWithPasskey(m.store, r.vault, pk("desconhecido"), "x")).rejects.toThrow("aparelho_nao_autorizado");
    expect(m.events.filter((e) => e === "unlock_failed").length).toBe(2);
  });

  it("aparelho revogado não abre mais (envelope apagado) e a recuperação não pode ser removida", async () => {
    const m = memStore(); const p = pk(); const r = await S.setupVault(m.store, p); await r.commit();
    const slot = m.slots.find((s) => s.kind === "passkey_prf")!;
    await S.revokeSlot(m.store, r.vault, slot);
    expect("ct" in m.slots.find((s) => s.id === slot.id)!.envelope).toBe(false);
    await expect(S.unlockWithPasskey(m.store, r.vault, p, "Mac")).rejects.toThrow("aparelho_nao_autorizado");
    await expect(S.revokeSlot(m.store, r.vault, m.slots.find((s) => s.kind === "recovery")!)).rejects.toThrow("manter_recuperacao");
  });

  it("nova chave de recuperação invalida a antiga", async () => {
    const m = memStore(); const r = await S.setupVault(m.store, null); await r.commit();
    const rot = await S.rotateRecovery(m.store, r.vault, r.dek); await rot.commit();
    await expect(S.unlockWithRecovery(m.store, r.vault, r.recoveryKey, "x")).rejects.toThrow();
    await expect(S.unlockWithRecovery(m.store, r.vault, rot.key, "x")).resolves.toBeTruthy();
  });

  it("não reconfigura um cofre já configurado (nunca sobrescreve a chave)", async () => {
    const m = memStore(); const r = await S.setupVault(m.store, null); await r.commit();
    await expect(S.setupVault(m.store, null)).rejects.toThrow("ja_configurado");
  });
});

describe("Cofre v2 — importação do cofre anterior", () => {
  it("importa só o que falta e não duplica ao repetir", async () => {
    const m = memStore(); const r = await S.setupVault(m.store, null); await r.commit();
    const legacy = [1, 2, 3].map((n) => ({ ...secret, title: `Antigo ${n}`, legacy_id: `old-${n}` }));
    expect(await S.importLegacy(m.store, r.vault, r.dek, legacy.slice(0, 2))).toBe(2);
    expect(await S.importLegacy(m.store, r.vault, r.dek, legacy)).toBe(1);
    expect(await S.importLegacy(m.store, r.vault, r.dek, legacy)).toBe(0);
    const all = await S.readEntries(m.store, r.vault, r.dek);
    expect(all.map((e) => e.secret.legacy_id).sort()).toEqual(["old-1", "old-2", "old-3"]);
    expect(m.entries.some((e) => e.ciphertext.includes("Antigo"))).toBe(false);
  });
});
