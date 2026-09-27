import type { VaultSettingsRow } from "./service";
import { clearNativePin, getNativePinStatus, nativePinAvailable } from "./native-pin";
import { disableQuickUnlock, getQuickUnlock } from "./quick-unlock";

export const QUICK_UNLOCK_RESET_MESSAGE =
  "Por segurança, configure novamente seu PIN e a biometria de desbloqueio rápido.";

export class VaultKeyChangedError extends Error {
  constructor() {
    super(`Use a senha mestra atual. ${QUICK_UNLOCK_RESET_MESSAGE}`);
    this.name = "VaultKeyChangedError";
  }
}

type State = { generation: string; pin?: string; biometric?: string; reset?: boolean };
// Only public vault configuration identifiers, never a key, password or PIN.
const invalidated = new Map<string, State>();
const storageKey = (userId: string) => `vault:quick-state:${userId}`;

function generation(userId: string, settings: VaultSettingsRow) {
  if (settings.user_id !== userId) throw new Error("Configuração de outro Cofre.");
  return JSON.stringify([settings.salt, settings.verifier, settings.verifier_iv, settings.iterations]);
}

function read(userId: string): State | null {
  if (invalidated.has(userId)) return invalidated.get(userId)!;
  try {
    const state = JSON.parse(localStorage.getItem(storageKey(userId)) || "null");
    return typeof state?.generation === "string" ? state : null;
  } catch {
    return null;
  }
}

export function quickCredentialIsCurrent(
  userId: string, kind: "pin" | "biometric", settings: VaultSettingsRow,
) {
  return read(userId)?.[kind] === generation(userId, settings);
}

/** Call only after the recovered/enrolled key was verified against fresh settings. */
export function rememberQuickCredential(
  userId: string, kind: "pin" | "biometric", settings: VaultSettingsRow,
) {
  const current = generation(userId, settings);
  const previous = read(userId);
  const state: State = previous?.generation === current ? { ...previous } : { generation: current };
  state[kind] = current;
  state.reset = false;
  localStorage.setItem(storageKey(userId), JSON.stringify(state));
  invalidated.delete(userId);
}

/** Persist rejection BEFORE cleanup, so refusal/failure cannot revive stale UI on reload. */
export async function invalidateQuickCredentials(userId: string, settings: VaultSettingsRow) {
  const state: State = { generation: generation(userId, settings), reset: true };
  invalidated.set(userId, state);
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
    invalidated.delete(userId);
  } catch { /* In-memory rejection remains; unbound credentials fail closed after reload. */ }
  return Promise.allSettled([clearNativePin(userId), disableQuickUnlock(userId)]);
}

export async function syncQuickCredentials(userId: string, settings: VaultSettingsRow) {
  const current = generation(userId, settings);
  let state = read(userId);
  if (state && state.generation !== current) {
    await invalidateQuickCredentials(userId, settings);
    state = read(userId);
  }
  const rawPin = nativePinAvailable() ? await getNativePinStatus(userId) : null;
  const rawBio = getQuickUnlock(userId);
  const pinNeedsSetup = rawPin?.configured === true && state?.pin !== current;
  const bioNeedsSetup = !!rawBio && state?.biometric !== current;
  return {
    nativePin: pinNeedsSetup
      ? { configured: false, failedAttempts: 0, lockedUntil: null }
      : rawPin,
    biometric: bioNeedsSetup ? null : rawBio,
    needsReconfiguration: state?.reset === true || pinNeedsSetup || bioNeedsSetup,
    pinNeedsSetup,
  };
}
