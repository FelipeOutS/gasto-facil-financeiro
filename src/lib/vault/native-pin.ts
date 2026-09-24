import {
  exportMasterKeyRaw,
  importMasterKeyRaw,
  vaultB64decode,
  vaultB64encode,
} from "./crypto";

export type NativePinStatus = {
  configured: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
};

type NativePinResult = {
  success: boolean;
  userId?: string;
  configured?: boolean;
  failed_attempts?: number;
  locked_until?: number | null;
  master_key?: string;
  error?: string;
};

type NativeVaultPinBridge = {
  version: 1;

  status(
    userId: string,
  ): Promise<NativePinResult>;

  enroll(
    userId: string,
    pin: string,
    masterKey: string,
  ): Promise<NativePinResult>;

  unlock(
    userId: string,
    pin: string,
  ): Promise<NativePinResult>;

  clear(
    userId: string,
  ): Promise<NativePinResult>;
};

declare global {
  interface Window {
    NativeVaultPin?: NativeVaultPinBridge;
  }
}

function getBridge(): NativeVaultPinBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  const bridge = window.NativeVaultPin;

  if (!bridge || bridge.version !== 1) {
    return null;
  }

  if (
    typeof bridge.status !== "function" ||
    typeof bridge.enroll !== "function" ||
    typeof bridge.unlock !== "function" ||
    typeof bridge.clear !== "function"
  ) {
    return null;
  }

  return bridge;
}

export function nativePinAvailable(): boolean {
  return getBridge() !== null;
}

function normalizeStatus(
  result: NativePinResult,
): NativePinStatus {
  return {
    configured:
      result.configured === true,

    failedAttempts:
      typeof result.failed_attempts === "number"
        ? Math.max(
            0,
            result.failed_attempts,
          )
        : 0,

    lockedUntil:
      typeof result.locked_until === "number"
        ? result.locked_until
        : null,
  };
}

function resultError(
  result: NativePinResult,
  fallback: string,
): Error {
  return new Error(
    typeof result.error === "string" &&
      result.error.trim()
      ? result.error
      : fallback,
  );
}

export async function getNativePinStatus(
  userId: string,
): Promise<NativePinStatus> {
  const bridge = getBridge();

  if (!bridge) {
    return {
      configured: false,
      failedAttempts: 0,
      lockedUntil: null,
    };
  }

  const result =
    await bridge.status(
      userId,
    );

  if (
    !result.success ||
    result.userId !== userId
  ) {
    throw resultError(
      result,
      "Não foi possível verificar o PIN seguro deste dispositivo.",
    );
  }

  return normalizeStatus(
    result,
  );
}

/**
 * Cria o novo PIN local seguro.
 *
 * A Master Key é exportada apenas durante a operação,
 * enviada pelo canal seguro do WebView e imediatamente
 * apagada do buffer local.
 *
 * O PIN legado do servidor NÃO é alterado aqui.
 */
export async function enrollNativePin(
  userId: string,
  pin: string,
  masterKey: CryptoKey,
): Promise<NativePinStatus> {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error(
      "O PIN deve conter exatamente 6 dígitos.",
    );
  }

  const bridge =
    getBridge();

  if (!bridge) {
    throw new Error(
      "O PIN seguro deste dispositivo não está disponível.",
    );
  }

  const raw =
    await exportMasterKeyRaw(
      masterKey,
    );

  try {
    const result =
      await bridge.enroll(
        userId,
        pin,
        vaultB64encode(raw),
      );

    if (
      !result.success ||
      result.userId !== userId
    ) {
      throw resultError(
        result,
        "Não foi possível configurar o PIN seguro neste dispositivo.",
      );
    }

    const status =
      normalizeStatus(
        result,
      );

    if (!status.configured) {
      throw new Error(
        "O Android não confirmou a configuração do novo PIN.",
      );
    }

    return status;
  } finally {
    raw.fill(0);
  }
}

/**
 * Recupera a Master Key através do PIN local do aparelho.
 */
export async function unlockWithNativePin(
  userId: string,
  pin: string,
): Promise<CryptoKey> {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error(
      "O PIN deve conter exatamente 6 dígitos.",
    );
  }

  const bridge =
    getBridge();

  if (!bridge) {
    throw new Error(
      "O PIN seguro deste dispositivo não está disponível.",
    );
  }

  const result =
    await bridge.unlock(
      userId,
      pin,
    );

  if (
    !result.success ||
    result.userId !== userId ||
    typeof result.master_key !== "string"
  ) {
    throw resultError(
      result,
      "Não foi possível abrir o Cofre com o PIN.",
    );
  }

  let raw:
    | Uint8Array<ArrayBuffer>
    | null = null;

  try {
    raw =
      vaultB64decode(
        result.master_key,
      );

    if (raw.length !== 32) {
      throw new Error(
        "A chave retornada pelo dispositivo é inválida.",
      );
    }

    return await importMasterKeyRaw(
      raw,
    );
  } finally {
    raw?.fill(0);
  }
}

/**
 * Remove somente o novo PIN local deste aparelho.
 *
 * Não remove o PIN legado do Supabase.
 */
export async function clearNativePin(
  userId: string,
): Promise<void> {
  const bridge =
    getBridge();

  if (!bridge) {
    return;
  }

  const result =
    await bridge.clear(
      userId,
    );

  if (
    !result.success ||
    result.userId !== userId
  ) {
    throw resultError(
      result,
      "Não foi possível remover o PIN seguro deste dispositivo.",
    );
  }
}