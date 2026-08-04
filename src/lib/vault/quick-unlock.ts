// Desbloqueio rápido por BIOMETRIA (este módulo NÃO trata mais o PIN,
// que agora é GLOBAL por conta — ver src/lib/vault/server-pin.ts).
//
// Dois caminhos:
//  1) WebAuthn + PRF (navegadores modernos no desktop e Chrome Android).
//  2) Bridge nativa em WebView Android via `window.AndroidBiometric`.
//
// Em ambos os casos a chave-mestra do Cofre é guardada localmente
// (cifrada). A biometria/PIN do aparelho é o "portão" — desbloquear
// expõe a chave-mestra ao app só na sessão atual.

import {
  exportMasterKeyRaw,
  importMasterKeyRaw,
  vaultB64decode,
  vaultB64encode,
  vaultRandomBytes,
} from "./crypto";

type QuickUnlockBase = {
  v: 1;
  createdAt: number;
  attempts: number;
};

type WebauthnRecord = QuickUnlockBase & {
  kind: "webauthn";
  credentialId: string;
  prfSalt: string;
  iv: string;
  wrapped: string;
};

type AndroidBioRecord = QuickUnlockBase & {
  kind: "android-bio";
  iv: string;
  wrapped: string;
  localKey: string; // chave AES local; bridge nativa é o portão
};

export type QuickUnlockRecord = WebauthnRecord | AndroidBioRecord;

function storageKey(userId: string) {
  return `vault:quick:${userId}`;
}

const ANDROID_BIOMETRIC_ENABLED_KEY = "vault_android_biometric_enabled";

/** Retorna o registro local de biometria (ignora registros antigos de PIN). */
export function getQuickUnlock(userId: string): QuickUnlockRecord | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const rec = JSON.parse(raw) as { kind?: string } & QuickUnlockRecord;
    if (rec.kind === "webauthn" || rec.kind === "android-bio") return rec;
    // Registro legado (kind=pin local) — descarta silenciosamente
    localStorage.removeItem(storageKey(userId));
    return null;
  } catch {
    return null;
  }
}

export function disableQuickUnlock(userId: string) {
  try {
    localStorage.removeItem(storageKey(userId));
    localStorage.removeItem(ANDROID_BIOMETRIC_ENABLED_KEY);
  } catch {}
}

function persist(userId: string, rec: QuickUnlockRecord) {
  localStorage.setItem(storageKey(userId), JSON.stringify(rec));
}

/* ----------------------------- Android Bridge ----------------------------- */

type AndroidBridge = {
  isAvailable?: () => boolean | string | Promise<boolean | string>;
  isBiometricAvailable?: () => boolean | string | Promise<boolean | string>;
  getBiometricStatus?: () => string | Promise<string>;
  authenticate?: (reason?: string) => void | string | boolean | Promise<string | boolean>;
  requestAuthentication?: (reason?: string) => void;
  unlock?: () => void;
};

type AndroidBiometricResultDetail = {
  success?: boolean;
  error?: string;
  errorCode?: string | number;
};

declare global {
  interface Window {
    AndroidBiometric?: AndroidBridge;
  }
  interface WindowEventMap {
    AndroidBiometricResult: CustomEvent<AndroidBiometricResultDetail>;
  }
}

export function getAndroidBridge(): AndroidBridge | null {
  if (typeof window === "undefined") return null;
  const b = window.AndroidBiometric;
  const found = !!b && typeof b.authenticate === "function";
  console.log("[VaultBiometric] Android bridge found:", found);
  if (!found) return null;
  return b;
}

export function hasAndroidBiometric(): boolean {
  return getAndroidBridge() !== null;
}

function truthyBridgeValue(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    return s === "true" || s === "available" || s === "success" || s === "ok";
  }
  return false;
}

/** Normaliza o retorno do bridge para um status legível. */
async function androidStatus(): Promise<string> {
  const b = getAndroidBridge();
  if (!b) return "unsupported";
  try {
    if (typeof b.isAvailable === "function") {
      const v = await b.isAvailable();
      console.log("[VaultBiometric] window.AndroidBiometric.isAvailable() result:", v);
      if (truthyBridgeValue(v)) return "available";
      if (v === false) return "none_enrolled";
      const s = String(v ?? "").toLowerCase();
      if (s) return s;
    }
    if (typeof b.getBiometricStatus === "function") {
      const s = await b.getBiometricStatus();
      return String(s ?? "").toLowerCase() || "unsupported";
    }
    if (typeof b.isBiometricAvailable === "function") {
      const v = await b.isBiometricAvailable();
      if (truthyBridgeValue(v)) return "available";
      if (v === false) return "none_enrolled";
      return String(v ?? "").toLowerCase() || "unsupported";
    }
  } catch {
    return "error";
  }
  return "unsupported";
}

/**
 * Aciona a biometria nativa do Android via bridge.
 * A bridge NÃO retorna Promise: o resultado vem pelo evento
 * `AndroidBiometricResult`. Registramos o listener ANTES de chamar
 * `authenticate()` para não perder o evento.
 */
function androidResultMessage(detail: AndroidBiometricResultDetail, fallback: string): string {
  if (typeof detail.error === "string" && detail.error.trim()) return detail.error;
  if (detail.errorCode) return `Erro biométrico: ${detail.errorCode}`;
  return fallback;
}

function androidAuthenticate(
  _reason: string,
  timeoutMs = 60_000,
): Promise<AndroidBiometricResultDetail> {
  return new Promise((resolve) => {
    const b = getAndroidBridge();
    if (!b?.authenticate) {
      resolve({ success: false, error: "Bridge biométrica Android não encontrada." });
      return;
    }

    let settled = false;
    const finish = (detail: AndroidBiometricResultDetail) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("AndroidBiometricResult", onResult as EventListener);
      clearTimeout(timer);
      resolve(detail);
    };
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AndroidBiometricResultDetail>).detail ?? {};
      console.log("[VaultBiometric] AndroidBiometricResult event received:", detail);
      finish(detail);
    };

    window.addEventListener("AndroidBiometricResult", onResult as EventListener, { once: true });
    const timer = setTimeout(
      () => finish({ success: false, error: "A biometria não respondeu. Tente novamente." }),
      timeoutMs,
    );

    try {
      b.authenticate();
      // Bridge Android nativa: não aguarde retorno direto; o resultado vem pelo evento.
    } catch (error) {
      console.log("[VaultBiometric] Error calling AndroidBiometric.authenticate():", error);
      finish({ success: false, error: "Falha ao iniciar a biometria nativa." });
    }
  });
}

/* ----------------------------- WebAuthn ----------------------------- */

export function isBiometricSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (window.AndroidBiometric) return true;
  return (
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.credentials
  );
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  // Preferência: bridge nativa Android no WebView
  const bridge = getAndroidBridge();
  if (bridge) {
    const s = await androidStatus();
    return s === "available" || s === "success";
  }
  if (typeof window === "undefined" || typeof window.PublicKeyCredential === "undefined") {
    return false;
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Mensagem amigável em português para a indisponibilidade da biometria. */
export async function biometricUnavailableReason(): Promise<string | null> {
  const bridge = getAndroidBridge();
  if (bridge) {
    const s = await androidStatus();
    if (s === "available" || s === "success") return null;
    if (s === "no_hardware") return "Este aparelho não tem leitor biométrico.";
    if (s === "none_enrolled")
      return "Biometria indisponível ou não cadastrada neste aparelho. Cadastre a digital nas configurações do celular ou use o PIN.";
    if (s === "hardware_unavailable")
      return "Biometria temporariamente indisponível neste aparelho.";
    return "Biometria indisponível neste aparelho.";
  }
  const ok = await isPlatformAuthenticatorAvailable();
  return ok ? null : "Biometria indisponível neste navegador.";
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

/** Cadastra biometria neste dispositivo (Android bridge OU WebAuthn-PRF). */
export async function enableBiometricUnlock(
  userId: string,
  userLabel: string,
  masterKey: CryptoKey,
): Promise<void> {
  const bridge = getAndroidBridge();
  if (bridge) {
    const status = await androidStatus();
    if (status !== "available" && status !== "success") {
      const reason = await biometricUnavailableReason();
      throw new Error(reason ?? "Biometria indisponível neste aparelho.");
    }
    // Confirma a biometria agora para validar a configuração
    const result = await androidAuthenticate("Confirme para ativar a biometria no Cofre");
    if (result.success !== true) {
      throw new Error(androidResultMessage(result, "Cadastro de biometria cancelado."));
    }
    // Armazena a chave-mestra cifrada localmente. A bridge é o portão.
    try {
      localStorage.setItem(ANDROID_BIOMETRIC_ENABLED_KEY, "true");
      const localKey = vaultRandomBytes(32);
      const aesKey = await importRawAesKey(toBuf(localKey));
      const iv = vaultRandomBytes(12);
      const raw = await exportMasterKeyRaw(masterKey);
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, raw);
      const rec: AndroidBioRecord = {
        v: 1,
        kind: "android-bio",
        createdAt: Date.now(),
        attempts: 0,
        iv: vaultB64encode(iv),
        wrapped: vaultB64encode(new Uint8Array(ct)),
        localKey: vaultB64encode(localKey),
      };
      persist(userId, rec);
      console.log("[VaultBiometric] Local biometric flag saved successfully.");
    } catch (error) {
      console.log("[VaultBiometric] Error saving local biometric flag:", error);
      throw new Error("Falha ao salvar a configuração local da biometria.");
    }
    return;
  }

  if (!isBiometricSupported()) throw new Error("Biometria indisponível neste dispositivo.");

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
}

export async function unlockWithBiometric(userId: string): Promise<CryptoKey> {
  const rec = getQuickUnlock(userId);
  if (!rec) throw new Error("Biometria não configurada neste dispositivo.");

  if (rec.kind === "android-bio") {
    const result = await androidAuthenticate("Use a biometria para abrir o Cofre");
    if (result.success !== true) {
      throw new Error(androidResultMessage(result, "Autenticação biométrica cancelada."));
    }
    const aesKey = await importRawAesKey(toBuf(vaultB64decode(rec.localKey)));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: vaultB64decode(rec.iv) },
      aesKey,
      vaultB64decode(rec.wrapped),
    );
    return importMasterKeyRaw(new Uint8Array(plain));
  }

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
