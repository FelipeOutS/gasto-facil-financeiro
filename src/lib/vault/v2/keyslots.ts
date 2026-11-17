// Cofre v2 (sem senha mestra): chave do cofre (DEK) aleatória de 256 bits,
// embrulhada por "keyslots". Nenhum slot é derivado só de PIN ou de papel/admin.
// Tudo roda no aparelho; o servidor guarda apenas envelopes cifrados.

type Bytes = Uint8Array<ArrayBuffer>;
export type SlotKind = "passkey_prf" | "recovery" | "passkey_prf_pin";
export type Envelope = { v: 1; kind: SlotKind; salt: string; iv: string; ct: string };

const enc = new TextEncoder();
const b64 = (u: Bytes) => btoa(String.fromCharCode(...u));
const unb64 = (s: string): Bytes => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Bytes;
export function randomBytes(n: number): Bytes {
  const b = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(b);
  return b;
}

export async function generateDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function kek(material: Bytes, salt: Bytes, kind: SlotKind): Promise<CryptoKey> {
  if (material.length < 32) throw new Error("material_insuficiente");
  const base = await crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode(`gi-vault-v2:${kind}`) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapDek(dek: CryptoKey, material: Bytes, kind: SlotKind): Promise<Envelope> {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", dek));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(kind) },
    await kek(material, salt, kind),
    raw,
  );
  raw.fill(0);
  return { v: 1, kind, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function unwrapDek(env: Envelope, material: Bytes): Promise<CryptoKey> {
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(env.iv), additionalData: enc.encode(env.kind) },
    await kek(material, unb64(env.salt), env.kind),
    unb64(env.ct),
  );
  // não exportável depois de aberta: fica só na memória da sessão
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// Chave de recuperação: 256 bits em Crockford base32, grupos de 4.
const ALPH = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function generateRecoveryKey(): string {
  const bytes = randomBytes(32);
  let bits = "";
  bytes.forEach((b) => (bits += b.toString(2).padStart(8, "0")));
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += ALPH[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out.match(/.{1,4}/g)!.join("-");
}
export function recoveryMaterial(key: string): Bytes {
  const clean = key.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (clean.length !== 52) throw new Error("chave_recuperacao_invalida");
  let bits = "";
  for (const c of clean) {
    const i = ALPH.indexOf(c);
    if (i < 0) throw new Error("chave_recuperacao_invalida");
    bits += i.toString(2).padStart(5, "0");
  }
  const out = new Uint8Array(new ArrayBuffer(32));
  for (let i = 0; i < 32; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

// PIN só como 2º fator: material = PRF da passkey || PIN. Sem PRF não abre.
export async function prfPinMaterial(prf: Bytes, pin: string): Promise<Bytes> {
  if (!/^\d{6}$/.test(pin)) throw new Error("pin_invalido");
  if (prf.length < 32) throw new Error("prf_ausente");
  const joined = new Uint8Array([...prf, ...enc.encode(pin)]) as Bytes;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
}

export async function encryptEntry(dek: CryptoKey, plaintext: string) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dek, enc.encode(plaintext));
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}
export async function decryptEntry(dek: CryptoKey, e: { iv: string; ct: string }) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(e.iv) }, dek, unb64(e.ct));
  return new TextDecoder().decode(pt);
}
