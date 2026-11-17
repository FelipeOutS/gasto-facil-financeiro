import { describe, it, expect } from "vitest";
import * as k from "../src/lib/vault/v2/keyslots";

describe("cofre v2 sem senha mestra", () => {
  it("abre com passkey PRF e com chave de recuperação", async () => {
    const dek = await k.generateDek();
    const entry = await k.encryptEntry(dek, "segredo");
    const prf = k.randomBytes(32);
    const rec = k.generateRecoveryKey();
    const e1 = await k.wrapDek(dek, prf, "passkey_prf");
    const e2 = await k.wrapDek(dek, k.recoveryMaterial(rec), "recovery");
    expect(await k.decryptEntry(await k.unwrapDek(e1, prf), entry)).toBe("segredo");
    expect(await k.decryptEntry(await k.unwrapDek(e2, k.recoveryMaterial(rec.toLowerCase())), entry)).toBe("segredo");
  });
  it("recusa passkey de outro aparelho e chave errada", async () => {
    const dek = await k.generateDek();
    const env = await k.wrapDek(dek, k.randomBytes(32), "passkey_prf");
    await expect(k.unwrapDek(env, k.randomBytes(32))).rejects.toThrow();
    const r = await k.wrapDek(dek, k.recoveryMaterial(k.generateRecoveryKey()), "recovery");
    await expect(k.unwrapDek(r, k.recoveryMaterial(k.generateRecoveryKey()))).rejects.toThrow();
  });
  it("PIN sozinho nunca vira chave; PIN errado falha", async () => {
    await expect(k.prfPinMaterial(new Uint8Array(0), "123456")).rejects.toThrow("prf_ausente");
    await expect(k.prfPinMaterial(k.randomBytes(32), "12345")).rejects.toThrow("pin_invalido");
    const dek = await k.generateDek();
    const prf = k.randomBytes(32);
    const env = await k.wrapDek(dek, await k.prfPinMaterial(prf, "123456"), "passkey_prf_pin");
    await expect(k.unwrapDek(env, await k.prfPinMaterial(prf, "654321"))).rejects.toThrow();
    await k.unwrapDek(env, await k.prfPinMaterial(prf, "123456"));
  });
  it("envelope não pode trocar de tipo de slot", async () => {
    const dek = await k.generateDek();
    const m = k.randomBytes(32);
    const env = await k.wrapDek(dek, m, "passkey_prf");
    await expect(k.unwrapDek({ ...env, kind: "recovery" }, m)).rejects.toThrow();
  });
  it("chave de recuperação tem 256 bits e IVs não se repetem", async () => {
    expect(k.recoveryMaterial(k.generateRecoveryKey()).length).toBe(32);
    const dek = await k.generateDek();
    const a = await k.encryptEntry(dek, "x"), b = await k.encryptEntry(dek, "x");
    expect(a.iv).not.toBe(b.iv);
  });
});
