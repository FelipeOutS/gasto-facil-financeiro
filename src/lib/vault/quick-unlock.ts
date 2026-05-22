// Quick unlock: PIN (PBKDF2-wrap) + biometria via WebAuthn PRF.
// O cofre continua sendo desbloqueado SOMENTE com a chave mestra real.
// Aqui apenas armazenamos a chave mestra cifrada localmente, protegida por
// um PIN curto ou por uma chave derivada do autenticador (PRF), nunca em texto.

import {
  exportMasterKeyRaw,
  importMasterKeyRaw,
  vaultB64decode,
  vaultB64encode,
  vaultRandomBytes,
} from "./crypto";

const PIN_ITERATIONS = 600_000;
const MAX_PIN_ATTEMPTS = 5;
const PRF_SALT_INFO = "gi-vault-prf-v1";

type QuickUnlockBase = {
  v: 1;
  createdAt: number;
  attempts: number;
};

type PinRecord = QuickUnlockBase & {
  kind: "pin";
  salt: string;
  iv: string;
  wrapped: string;
  iterations: number;
};

type WebauthnRecord = QuickUnlockBase & {
  kind: "webauthn";
  credentialId: string; // base64
  prfSalt: string; // base64
  iv: string;
  wrapped: string;
};

export type QuickUnlockRecord = PinRecord | WebauthnRecord;

function storageKey(userId: string) {
  return `vault:quick:${userId}`;
}

export function getQuickUnlock(userId: string): QuickUnlockRecord | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as QuickUnlockRecord;
  } catch {
    return null;
  }
}

export function disableQuickUnlock(userId: string) {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {}
}

function persist(userId: string, rec: QuickUnlockRecord) {
  localStorage.setItem(storageKey(userId), JSON.stringify(rec));
}

/* ----------------------------- PIN ----------------------------- */

async function derivePinKey(pin: string, saltB64: string, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(pin);
  const buf = new Uint8Array(new ArrayBuffer(enc.byteLength));
  buf.set(enc);
  const base = await crypto.subtle.importKey("raw", buf, { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: vaultB64decode(saltB64), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function enablePinUnlock(
  userId: string,
  pin: string,
  masterKey: CryptoKey,
): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN deve ter de 4 a 8 dígitos numéricos");
  const salt = vaultB64encode(vaultRandomBytes(16));
  const wrapKey = await derivePinKey(pin, salt, PIN_ITERATIONS);
  const iv = vaultRandomBytes(12);
  const raw = await exportMasterKeyRaw(masterKey);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, raw);
  const rec: PinRecord = {
    v: 1,
    kind: "pin",
    createdAt: Date.now(),
    attempts: 0,
    iterations: PIN_ITERATIONS,
    salt,
    iv: vaultB64encode(iv),
    wrapped: vaultB64encode(new Uint8Array(ct)),
  };
  persist(userId, rec);
}

export async function unlockWithPin(userId: string, pin: string): Promise<CryptoKey> {
  const rec = getQuickUnlock(userId);
  if (!rec || rec.kind !== "pin") throw new Error("PIN não configurado");
  if (rec.attempts >= MAX_PIN_ATTEMPTS) {
    disableQuickUnlock(userId);
    throw new Error("Muitas tentativas. Use a senha mestra para entrar.");
  }
  try {
    const wrapKey = await derivePinKey(pin, rec.salt, rec.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: vaultB64decode(rec.iv) },
      wrapKey,
      vaultB64decode(rec.wrapped),
    );
    // Sucesso: zera tentativas
    persist(userId, { ...rec, attempts: 0 });
    return importMasterKeyRaw(new Uint8Array(plain));
  } catch {
    const attempts = rec.attempts + 1;
    if (attempts >= MAX_PIN_ATTEMPTS) {
      disableQuickUnlock(userId);
      throw new Error("PIN incorreto. Limite atingido — use a senha mestra.");
    }
    persist(userId, { ...rec, attempts });
    const left = MAX_PIN_ATTEMPTS - attempts;
    throw new Error(`PIN incorreto. Você tem ${left} tentativa(s) antes do bloqueio.`);
  }
}

export function pinAttemptsLeft(userId: string): number {
  const rec = getQuickUnlock(userId);
  if (!rec || rec.kind !== "pin") return MAX_PIN_ATTEMPTS;
  return Math.max(0, MAX_PIN_ATTEMPTS - rec.attempts);
}

/* ----------------------------- WebAuthn / Biometria ----------------------------- */

export function isBiometricSupported(): boolean {
  return typeof window !== "undefined"
    && typeof window.PublicKeyCredential !== "undefined"
    && typeof navigator !== "undefined"
    && !!navigator.credentials;
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function toBuf(u8: Uint8Array): ArrayBuffer {
  const b = new ArrayBuffer(u8.byteLength);
  new Uint8Array(b).set(u8);
  return b;
}

async function importRawAesKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function enableBiometricUnlock(
  userId: string,
  userLabel: string,
  masterKey: CryptoKey,
): Promise<void> {
  if (!isBiometricSupported()) throw new Error("Biometria indisponível neste dispositivo");

  const prfSalt = vaultRandomBytes(32);
  const challenge = vaultRandomBytes(32);
  const userIdBytes = new TextEncoder().encode(userId);
  const userIdBuf = new Uint8Array(new ArrayBuffer(userIdBytes.byteLength));
  userIdBuf.set(userIdBytes);

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: toBuf(challenge),
      rp: { name: "Gasto Inteligente" },
      user: {
        id: toBuf(userIdBuf),
        name: userLabel || "vault-user",
        displayName: userLabel || "Cofre Pessoal",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60_000,
      attestation: "none",
      extensions: { prf: { eval: { first: toBuf(prfSalt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!cred) throw new Error("Cadastro de biometria cancelado");

  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  let prfBytes: ArrayBuffer | undefined = ext?.prf?.results?.first;

  // Alguns autenticadores só liberam PRF no get() — fazemos um assert imediato para obter a chave.
  if (!prfBytes) {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: toBuf(vaultRandomBytes(32)),
        allowCredentials: [{ id: cred.rawId, type: "public-key" }],
        userVerification: "required",
        timeout: 60_000,
        extensions: { prf: { eval: { first: toBuf(prfSalt) } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    const ext2 = assertion?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
    prfBytes = ext2?.prf?.results?.first;
  }

  if (!prfBytes) {
    throw new Error("Seu navegador não expõe a extensão PRF necessária para biometria");
  }

  const wrapKey = await importRawAesKey(prfBytes);
  const iv = vaultRandomBytes(12);
  const raw = await exportMasterKeyRaw(masterKey);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, raw);

  const rec: WebauthnRecord = {
    v: 1,
    kind: "webauthn",
    createdAt: Date.now(),
    attempts: 0,
    credentialId: vaultB64encode(new Uint8Array(cred.rawId)),
    prfSalt: vaultB64encode(prfSalt),
    iv: vaultB64encode(iv),
    wrapped: vaultB64encode(new Uint8Array(ct)),
  };
  persist(userId, rec);
  // Marca preferência de informação adicional
  try {
    localStorage.setItem(`${storageKey(userId)}:label`, PRF_SALT_INFO);
  } catch {}
}

export async function unlockWithBiometric(userId: string): Promise<CryptoKey> {
  const rec = getQuickUnlock(userId);
  if (!rec || rec.kind !== "webauthn") throw new Error("Biometria não configurada");
  if (!isBiometricSupported()) throw new Error("Biometria indisponível neste dispositivo");

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: toBuf(vaultRandomBytes(32)),
      allowCredentials: [{ id: toBuf(vaultB64decode(rec.credentialId)), type: "public-key" }],
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { eval: { first: toBuf(vaultB64decode(rec.prfSalt)) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error("Autenticação biométrica cancelada");
  const ext = assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  const prfBytes = ext?.prf?.results?.first;
  if (!prfBytes) throw new Error("Falha ao derivar chave biométrica (PRF não retornou)");

  const wrapKey = await importRawAesKey(prfBytes);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: vaultB64decode(rec.iv) },
    wrapKey,
    vaultB64decode(rec.wrapped),
  );
  return importMasterKeyRaw(new Uint8Array(plain));
}
