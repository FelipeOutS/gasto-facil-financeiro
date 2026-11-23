import { test, expect, mock, afterEach } from "bun:test";
let mail: Record<string, unknown> | null = null;
let challenge: Record<string, string> | null = null;
let verified = false;
mock.module("@lovable.dev/email-js", () => ({
  sendLovableEmail: async (payload: Record<string, unknown>) => {
    mail = payload;
  },
}));
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (
      name: string,
      args: Record<string, string> & { p_delivery?: Record<string, unknown> },
    ) => {
      if (name.endsWith("begin")) {
        mail = args.p_delivery ?? null;
        challenge = args;
        return { data: true, error: null };
      }
      if (name.endsWith("verify")) {
        const ok =
          !verified &&
          args.p_hash === challenge?.p_hash &&
          args.p_email === challenge?.p_email &&
          args.p_nonce === challenge?.p_nonce;
        if (ok) verified = true;
        return { data: ok, error: null };
      }
      throw Error("unexpected");
    },
  },
}));
const { vaultEmail } = await import("../src/server/vault-v2-email.server");
const oldService = process.env.SUPABASE_SERVICE_ROLE_KEY,
  oldMail = process.env.LOVABLE_API_KEY;
afterEach(() => {
  if (oldService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = oldService;
  if (oldMail === undefined) delete process.env.LOVABLE_API_KEY;
  else process.env.LOVABLE_API_KEY = oldMail;
  challenge = null;
  mail = null;
  verified = false;
});
const client = (confirmed = true, id = "user") =>
  ({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id,
            email: "verified@example.com",
            email_confirmed_at: confirmed ? "date" : null,
          },
        },
        error: null,
      }),
    },
  }) as never;
test("email queues 6 digits only to verified Auth email, stores keyed digest and never returns code", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "isolated-fake-hmac-key";
  process.env.LOVABLE_API_KEY = "isolated-fake-provider-key";
  const result = await vaultEmail("begin", client(), "user", { vault: "vault" });
  expect("nonce" in result).toBe(true);
  expect(mail?.to).toBe("verified@example.com");
  const code = String(mail?.text).match(/\b\d{6}\b/)![0];
  expect(challenge?.p_hash.length).toBe(64);
  expect(JSON.stringify(result)).not.toContain(code);
  await expect(
    vaultEmail("verify", client(), "user", {
      vault: "vault",
      nonce: challenge!.p_nonce,
      code: code === "000000" ? "000001" : "000000",
    }),
  ).rejects.toThrow("codigo_invalido");
  await expect(
    vaultEmail("verify", client(), "user", { vault: "vault", nonce: challenge!.p_nonce, code }),
  ).resolves.toEqual({ verified: true });
  await expect(
    vaultEmail("verify", client(), "user", { vault: "vault", nonce: challenge!.p_nonce, code }),
  ).rejects.toThrow("codigo_invalido");
});
test("unverified email or mismatched authenticated identity cannot request recovery", async () => {
  await expect(vaultEmail("begin", client(false), "user", { vault: "vault" })).rejects.toThrow(
    "email_nao_verificado",
  );
  await expect(
    vaultEmail("begin", client(true, "attacker"), "user", { vault: "vault" }),
  ).rejects.toThrow("email_nao_verificado");
  expect(mail).toBeNull();
  expect(challenge).toBeNull();
});
