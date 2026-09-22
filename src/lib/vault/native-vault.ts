import { vaultB64decode } from "./crypto";

export type NativeVaultResult = {
  success: boolean;
  available?: boolean;
  userId?: string;
  master_key?: string;
  error?: string;
};

/** The implementation must bind each unlock/enrollment to an OS-authenticated
 * cryptographic operation, not an event saying that biometrics succeeded.
 * Android implements this on the existing secure-session channel. An eventual
 * iOS adapter must enforce the same contract with Keychain/LocalAuthentication.
 * Key material crosses this channel only in memory, never logs or web storage. */
export type NativeVaultBridge = {
  version: 2;
  status(): Promise<NativeVaultResult>;
  enroll(userId: string, masterKey: string): Promise<NativeVaultResult>;
  unlock(userId: string): Promise<NativeVaultResult>;
  clear(userId: string): Promise<NativeVaultResult>;
};

declare global {
  interface Window {
    NativeVault?: NativeVaultBridge;
    // Compatibility declaration for other existing app flows. The vault never calls it.
    AndroidBiometric?: {
      isAvailable?: () => boolean | string | Promise<boolean | string>;
      isBiometricAvailable?: () => boolean | string | Promise<boolean | string>;
      getBiometricStatus?: () => string | Promise<string>;
      authenticate?: (reason?: string) => void | string | boolean | Promise<string | boolean>;
      requestAuthentication?: (reason?: string) => void;
      unlock?: () => void;
    };
  }
}

export function getNativeVault(): NativeVaultBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.NativeVault;
  return bridge?.version === 2 &&
    [bridge.status, bridge.enroll, bridge.unlock, bridge.clear].every(
      (method) => typeof method === "function",
    )
    ? bridge
    : null;
}

export function isNativeContainer(): boolean {
  if (typeof window === "undefined") return false;
  // Detect older Android builds too: they must fail closed, never use the legacy bridge.
  return !!(
    window.NativeVault ||
    window.AndroidSecureSession ||
    (window as Window & { AndroidBiometric?: unknown }).AndroidBiometric
  );
}

export async function nativeVaultAvailable(): Promise<boolean> {
  try {
    const status = await getNativeVault()?.status();
    return status?.success === true && status.available === true;
  } catch {
    return false;
  }
}

export function nativeVaultKey(result: NativeVaultResult, userId: string): Uint8Array<ArrayBuffer> {
  if (!result.success || result.userId !== userId || typeof result.master_key !== "string") {
    throw new Error("Biometria não autorizada. Use a senha mestra ou o PIN do Cofre.");
  }
  try {
    const raw = vaultB64decode(result.master_key);
    if (raw.length === 32) return raw;
    raw.fill(0);
  } catch {
    /* Corrupt native response: never import partial material. */
  }
  throw new Error("Proteção biométrica inválida. Use a senha mestra/PIN e configure novamente.");
}
