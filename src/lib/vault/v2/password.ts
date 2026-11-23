import { randomBytes, type Envelope } from "./keyslots";

export type PasswordEnvelope = Envelope & {
  kind: "password";
  kdf: "PBKDF2-SHA256";
  iterations: 600000;
  context: string;
};
const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const context = (user: string, vault: string) =>
  JSON.stringify(["gi-vault-v2-password", user, vault]);
async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  if (password.length > 1024) throw Error("senha_invalida");
  const material = enc.encode(password);
  try {
    const base = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 600000 },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    material.fill(0);
  }
}
export async function wrapPassword(
  dek: CryptoKey,
  password: string,
  user: string,
  vault: string,
): Promise<PasswordEnvelope> {
  if (password.length < 12 || password.length > 1024) throw Error("senha_minima");
  const salt = randomBytes(32),
    iv = randomBytes(12),
    aad = context(user, vault);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", dek));
  try {
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(aad) },
      await derive(password, salt),
      raw,
    );
    return {
      v: 1,
      kind: "password",
      kdf: "PBKDF2-SHA256",
      iterations: 600000,
      context: aad,
      salt: b64(salt),
      iv: b64(iv),
      ct: b64(new Uint8Array(ct)),
    };
  } finally {
    raw.fill(0);
  }
}
export async function unwrapPassword(
  env: PasswordEnvelope,
  password: string,
  user: string,
  vault: string,
) {
  if (
    env.v !== 1 ||
    env.kind !== "password" ||
    env.kdf !== "PBKDF2-SHA256" ||
    env.iterations !== 600000 ||
    env.context !== context(user, vault)
  )
    throw Error("envelope_invalido");
  const salt = bytes(env.salt),
    iv = bytes(env.iv),
    ct = bytes(env.ct);
  if (salt.length !== 32 || iv.length !== 12 || ct.length !== 48) throw Error("envelope_invalido");
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(env.context) },
    await derive(password, salt),
    ct,
  );
  try {
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
  } finally {
    new Uint8Array(raw).fill(0);
  }
}
