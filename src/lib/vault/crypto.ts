// Web Crypto helpers: PBKDF2 + AES-GCM. All sensitive material stays in memory.

const VERIFIER_PLAINTEXT = "GASTO_INTELIGENTE_VAULT_OK_v1";
const DEFAULT_ITERATIONS = 250_000;

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(str: string): Uint8Array<ArrayBuffer> {
  const bin = atob(str);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(len: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(len));
  crypto.getRandomValues(b);
  return b;
}

export function generateSalt(): string {
  return b64encode(randomBytes(16));
}

async function deriveKey(password: string, saltB64: string, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64decode(saltB64), iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function createMasterKey(
  password: string,
): Promise<{ salt: string; iterations: number; verifier: string; verifier_iv: string; key: CryptoKey }> {
  const salt = generateSalt();
  const iterations = DEFAULT_ITERATIONS;
  const key = await deriveKey(password, salt, iterations);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(VERIFIER_PLAINTEXT),
  );
  return { salt, iterations, verifier: b64encode(ct), verifier_iv: b64encode(iv), key };
}

export async function unlockMasterKey(
  password: string,
  settings: { salt: string; iterations: number; verifier: string; verifier_iv: string },
): Promise<CryptoKey | null> {
  try {
    const key = await deriveKey(password, settings.salt, settings.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(settings.verifier_iv) },
      key,
      b64decode(settings.verifier),
    );
    const txt = new TextDecoder().decode(plain);
    return txt === VERIFIER_PLAINTEXT ? key : null;
  } catch {
    return null;
  }
}

export type EntrySecret = {
  username?: string;
  password?: string;
  notes?: string;
};

export async function encryptSecret(key: CryptoKey, secret: EntrySecret): Promise<{
  username_cipher: string;
  password_cipher: string;
  notes_cipher: string;
  cipher_iv: string;
}> {
  const enc = (txt: string, iv: Uint8Array) =>
    crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(txt));
  const ivU = randomBytes(12);
  const ivP = randomBytes(12);
  const ivN = randomBytes(12);
  // We persist a single canonical IV (for ref) and encode each cipher with own IV concatenated: iv||ct
  async function encField(txt: string, iv: Uint8Array): Promise<string> {
    const ct = await enc(txt, iv);
    const out = new Uint8Array(iv.length + ct.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ct), iv.length);
    return b64encode(out);
  }
  return {
    username_cipher: await encField(secret.username ?? "", ivU),
    password_cipher: await encField(secret.password ?? "", ivP),
    notes_cipher: await encField(secret.notes ?? "", ivN),
    cipher_iv: b64encode(ivU), // legacy/required column
  };
}

async function decField(key: CryptoKey, payload: string | null | undefined): Promise<string> {
  if (!payload) return "";
  const raw = b64decode(payload);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(plain);
}

export async function decryptSecret(
  key: CryptoKey,
  row: { username_cipher: string | null; password_cipher: string | null; notes_cipher: string | null },
): Promise<EntrySecret> {
  return {
    username: await decField(key, row.username_cipher),
    password: await decField(key, row.password_cipher),
    notes: await decField(key, row.notes_cipher),
  };
}
