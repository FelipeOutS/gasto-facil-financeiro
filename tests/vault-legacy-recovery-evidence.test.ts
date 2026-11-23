import { test, expect } from "bun:test";
import {
  createMasterKey,
  encryptSecret,
  decryptSecret,
  keyMatchesVaultSettings,
  exportMasterKeyRaw,
  importMasterKeyRaw,
  unlockMasterKey,
} from "../src/lib/vault/crypto";

test("legacy 14 synthetic credentials open only with original key; email/new password cannot replace it", async () => {
  const original = await createMasterKey("Senha antiga sintética exclusiva!42");
  const rows = await Promise.all(
    Array.from({ length: 14 }, (_, i) =>
      encryptSecret(original.key, {
        username: `user-${i}`,
        password: `secret-${i}`,
        notes: "synthetic only",
      }),
    ),
  );
  const before = JSON.stringify(rows);
  // Simulates an AUTHORIZED device returning the original key; does not access a device.
  const material = await exportMasterKeyRaw(original.key);
  const recovered = await importMasterKeyRaw(material);
  material.fill(0);
  expect(await keyMatchesVaultSettings(recovered, original)).toBe(true);
  for (let i = 0; i < rows.length; i++)
    expect((await decryptSecret(recovered, rows[i])).password).toBe(`secret-${i}`);
  const unrelated = await createMasterKey("Nova senha não recupera chave!42");
  expect(await keyMatchesVaultSettings(unrelated.key, original)).toBe(false);
  await expect(decryptSecret(unrelated.key, rows[0])).rejects.toThrow();
  expect(await unlockMasterKey("123456", original)).toBeNull();
  expect(JSON.stringify(rows)).toBe(before);
});
