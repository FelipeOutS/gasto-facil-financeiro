// Optional quick unlock. Password/PIN and vault ciphertext are unchanged.
// Android: OS-authenticated Keystore operation through the existing secure channel.
// Web: WebAuthn PRF only; never replace a missing PRF with a local secret.
import {
  exportMasterKeyRaw,
  importMasterKeyRaw,
  vaultB64decode,
  vaultB64encode,
  vaultRandomBytes,
} from "./crypto";
import {
  getNativeVault,
  isNativeContainer,
  nativeVaultAvailable,
  nativeVaultKey,
} from "./native-vault";

type WebauthnRecord = {
  v: 1;
  kind: "webauthn";
  createdAt: number;
  attempts: number;
  credentialId: string;
  prfSalt: string;
  iv: string;
  wrapped: string;
};
// Detection only. No code may import the legacy localKey or decrypt its wrapper.
type LegacyAndroidRecord = { v: 1; kind: "android-bio"; createdAt: number; attempts: number };
type NativeRecord = { v: 2; kind: "native-vault"; userId: string; createdAt: number };
export type QuickUnlockRecord = WebauthnRecord | LegacyAndroidRecord | NativeRecord;
const ANDROID_BIOMETRIC_ENABLED_KEY = "vault_android_biometric_enabled";
function storageKey(userId: string) {
  return `vault:quick:${userId}`;
}
function validBytes(value: unknown, size?: number): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const n = vaultB64decode(value).length;
    return size === undefined ? n > 0 : n === size;
  } catch {
    return false;
  }
}
export function getQuickUnlock(userId: string): QuickUnlockRecord | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const r = JSON.parse(raw);
    if (!r || typeof r !== "object" || !Number.isFinite(r.createdAt)) return null;
    if (r.v === 1 && r.kind === "android-bio") {
      return { v: 1, kind: "android-bio", createdAt: r.createdAt, attempts: 0 };
    }
    if (r.v === 2 && r.kind === "native-vault" && r.userId === userId) {
      return { v: 2, kind: "native-vault", userId, createdAt: r.createdAt };
    }
    if (
      r.v === 1 &&
      r.kind === "webauthn" &&
      validBytes(r.credentialId) &&
      validBytes(r.prfSalt, 32) &&
      validBytes(r.iv, 12) &&
      validBytes(r.wrapped, 48)
    ) {
      return {
        v: 1,
        kind: "webauthn",
        createdAt: r.createdAt,
        attempts: 0,
        credentialId: r.credentialId,
        prfSalt: r.prfSalt,
        iv: r.iv,
        wrapped: r.wrapped,
      };
    }
    return null;
  } catch {
    return null;
  }
}
export function needsQuickUnlockMigration(userId: string): boolean {
  try {
    const r = JSON.parse(localStorage.getItem(storageKey(userId)) || "null");
    return r?.kind === "android-bio";
  } catch {
    return false;
  }
}
export async function disableQuickUnlock(userId: string): Promise<void> {
  // Remove native material as well; never report a successful removal on refusal.
  const native = getNativeVault();
  if (!native && getQuickUnlock(userId)?.kind === "native-vault") {
    throw new Error("Abra no aplicativo atualizado para remover a proteção nativa.");
  }
  if (native) {
    const result = await native.clear(userId);
    if (!result.success) throw new Error("Não foi possível remover a biometria. Tente novamente.");
  }
  localStorage.removeItem(storageKey(userId));
  localStorage.removeItem(ANDROID_BIOMETRIC_ENABLED_KEY);
}
function persist(userId: string, rec: QuickUnlockRecord) {
  localStorage.setItem(storageKey(userId), JSON.stringify(rec));
}
export function isBiometricSupported(): boolean {
  if (isNativeContainer()) return !!getNativeVault();
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.credentials
  );
}
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (isNativeContainer()) return nativeVaultAvailable();
  if (!isBiometricSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}
export async function biometricUnavailableReason(): Promise<string | null> {
  if (await isPlatformAuthenticatorAvailable()) return null;
  return isNativeContainer()
    ? "Biometria segura indisponível. Atualize o aplicativo e cadastre uma biometria forte, ou use a senha mestra/PIN do Cofre."
    : "Este navegador precisa de um autenticador com WebAuthn PRF. Use a senha mestra ou o PIN do Cofre.";
}
function toBuf(u8: Uint8Array): ArrayBuffer {
  const b = new ArrayBuffer(u8.byteLength);
  new Uint8Array(b).set(u8);
  return b;
}
async function importRawAesKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}
/** Caller must already hold a key recovered by the legitimate password/PIN flow.
 * Legacy ciphertext is NEVER used as a migration source. Failure keeps it for an
 * explicit retry; successful native round-trip atomically replaces it with metadata. */
export async function migrateLegacyQuickUnlock(
  userId: string,
  label: string,
  verifiedKey: CryptoKey,
): Promise<boolean> {
  if (!needsQuickUnlockMigration(userId)) return false;
  await enableBiometricUnlock(userId, label, verifiedKey);
  return true;
}
export async function enableBiometricUnlock(
  userId: string,
  userLabel: string,
  masterKey: CryptoKey,
): Promise<void> {
  if (isNativeContainer()) {
    const native = getNativeVault();
    if (!native || !(await nativeVaultAvailable()))
      throw new Error((await biometricUnavailableReason())!);
    const raw = await exportMasterKeyRaw(masterKey);
    try {
      const response = await native.enroll(userId, vaultB64encode(raw));
      const confirmed = nativeVaultKey(response, userId);
      try {
        if (confirmed.length !== raw.length || !confirmed.every((b, i) => b === raw[i]))
          throw new Error("A proteção do Cofre não pôde ser confirmada. Use a senha mestra.");
      } finally {
        confirmed.fill(0);
      }
      persist(userId, { v: 2, kind: "native-vault", userId, createdAt: Date.now() });
      localStorage.removeItem(ANDROID_BIOMETRIC_ENABLED_KEY);
    } finally {
      raw.fill(0);
    }
    return;
  }
  if (!isBiometricSupported())
    throw new Error("Biometria indisponível. Use a senha mestra ou o PIN do Cofre.");
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
      extensions: {
        prf: { eval: { first: toBuf(prfSalt) } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!cred) throw new Error("Cadastro de biometria cancelado.");

  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  let prfBytes: ArrayBuffer | undefined = ext?.prf?.results?.first;

  if (!prfBytes) {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: toBuf(vaultRandomBytes(32)),
        allowCredentials: [{ id: cred.rawId, type: "public-key" }],
        userVerification: "required",
        timeout: 60_000,
        extensions: {
          prf: { eval: { first: toBuf(prfSalt) } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    const ext2 = assertion?.getClientExtensionResults() as {
      prf?: { results?: { first?: ArrayBuffer } };
    };
    prfBytes = ext2?.prf?.results?.first;
  }

  if (!prfBytes) {
    throw new Error("Seu navegador não expõe a extensão PRF necessária para biometria.");
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
  localStorage.removeItem(ANDROID_BIOMETRIC_ENABLED_KEY);
}

export async function unlockWithBiometric(userId: string): Promise<CryptoKey> {
  const rec = getQuickUnlock(userId);
  if (needsQuickUnlockMigration(userId))
    throw new Error(
      "Abra o Cofre com sua senha mestra ou PIN para atualizar a proteção biométrica.",
    );
  if (!rec)
    throw new Error("Biometria não configurada ou registro inválido. Use a senha mestra ou o PIN.");
  if (rec.kind === "android-bio")
    throw new Error("Use a senha mestra ou o PIN para migrar a biometria.");
  if (rec.kind === "native-vault") {
    const native = getNativeVault();
    if (!native) throw new Error("Abra no aplicativo atualizado ou use a senha mestra/PIN.");
    const raw = nativeVaultKey(await native.unlock(userId), userId);
    try {
      return await importMasterKeyRaw(raw);
    } finally {
      raw.fill(0);
    }
  }
  // A native container must never fall back to a web/event-only authenticator.
  if (isNativeContainer())
    throw new Error("Use a senha mestra/PIN e configure a biometria segura do aplicativo.");
  // WebAuthn-PRF
  if (!isBiometricSupported()) throw new Error("Biometria indisponível neste dispositivo.");
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: toBuf(vaultRandomBytes(32)),
      allowCredentials: [{ id: toBuf(vaultB64decode(rec.credentialId)), type: "public-key" }],
      userVerification: "required",
      timeout: 60_000,
      extensions: {
        prf: { eval: { first: toBuf(vaultB64decode(rec.prfSalt)) } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error("Autenticação biométrica cancelada.");
  const ext = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const prfBytes = ext?.prf?.results?.first;
  if (!prfBytes) throw new Error("Falha ao derivar chave biométrica (PRF não retornou).");

  const wrapKey = await importRawAesKey(prfBytes);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: vaultB64decode(rec.iv) },
    wrapKey,
    vaultB64decode(rec.wrapped),
  );
  return importMasterKeyRaw(new Uint8Array(plain));
}
