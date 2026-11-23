import { test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { evaluate } from "../src/lib/vault/v2/passkey";
test("passkey requires verified user and PRF; biometric event without key material never unlocks", async () => {
  const slot = { credentialId: "AQID", prfSalt: btoa("s".repeat(32)) };
  let result: unknown = {
    rawId: new Uint8Array([1, 2, 3]).buffer,
    getClientExtensionResults: () => ({
      prf: { results: { first: new Uint8Array(32).fill(7).buffer } },
    }),
  };
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: {
      get: async (options: CredentialRequestOptions) => {
        expect(options.publicKey?.userVerification).toBe("required");
        expect(options.publicKey?.allowCredentials?.length).toBe(1);
        return result;
      },
    },
  });
  expect((await evaluate([slot])).prf.length).toBe(32);
  result = { rawId: new Uint8Array([1, 2, 3]).buffer, getClientExtensionResults: () => ({}) };
  await expect(evaluate([slot])).rejects.toThrow("prf_nao_suportado");
  result = null;
  await expect(evaluate([slot])).rejects.toThrow("cancelado");
});
