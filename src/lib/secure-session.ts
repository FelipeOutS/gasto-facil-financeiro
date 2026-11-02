// Integração com a bridge nativa Android `window.AndroidSecureSession`.
//
// Esta bridge usa o Android Keystore para armazenar o par
// access_token/refresh_token do Supabase de forma protegida por biometria.
// Diferente de `AndroidBiometric`, aqui a sessão é devolvida no callback
// `AndroidSecureSessionResult` apenas após a digital ser aprovada.
//
// Métodos esperados:
//  - saveSession(accessToken, refreshToken, userId, email)
//  - hasSession(): boolean
//  - getSavedEmail(): string | null
//  - unlockSession(): void   -> dispara AndroidSecureSessionResult
//  - clearSession(): void
//
// Evento: window.addEventListener('AndroidSecureSessionResult', e => e.detail)
//   detail: { success: boolean, access_token?: string, refresh_token?: string, error?: string }

import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AndroidSecureSessionBridge = {
  saveSession?: (
    accessToken: string,
    refreshToken: string,
    userId: string,
    email: string,
  ) => void | boolean | Promise<boolean>;
  hasSession?: () => boolean;
  getSavedEmail?: () => string | null;
  unlockSession?: () => void | Promise<AndroidSecureSessionResultDetail>;
  clearSession?: () => void | Promise<unknown>;
};

export type AndroidSecureSessionResultDetail = {
  success?: boolean;
  access_token?: string;
  refresh_token?: string;
  error?: string;
};

declare global {
  interface Window {
    AndroidSecureSession?: AndroidSecureSessionBridge;
  }
  interface WindowEventMap {
    AndroidSecureSessionResult: CustomEvent<AndroidSecureSessionResultDetail>;
  }
}

export function getSecureSessionBridge(): AndroidSecureSessionBridge | null {
  if (typeof window === "undefined") return null;
  const b = window.AndroidSecureSession;
  if (!b) return null;
  return b;
}

export function hasSecureSessionBridge(): boolean {
  return getSecureSessionBridge() !== null;
}

export function hasSavedSecureSession(): boolean {
  const b = getSecureSessionBridge();
  if (!b || typeof b.hasSession !== "function") return false;
  try {
    return !!b.hasSession();
  } catch {
    return false;
  }
}

export function getSavedSecureEmail(): string | null {
  const b = getSecureSessionBridge();
  if (!b || typeof b.getSavedEmail !== "function") return null;
  try {
    return b.getSavedEmail() ?? null;
  } catch {
    return null;
  }
}

export async function clearSecureSession(): Promise<boolean> {
  const b = getSecureSessionBridge();
  if (!b) return true;
  if (typeof b.clearSession !== "function") return false;
  try {
    const result = await b.clearSession();
    return result === undefined || result === true ||
      (typeof result === "object" && result !== null && "success" in result && result.success === true);
  } catch { return false; }
}

/**
 * Salva a sessão atual do Supabase no Android Keystore via bridge nativa.
 * Não salva senha. Não loga tokens.
 */
export async function saveSecureSession(session: Session | null | undefined): Promise<boolean> {
  const b = getSecureSessionBridge();
  if (!b || typeof b.saveSession !== "function") return false;
  if (
    !session?.access_token ||
    !session.refresh_token ||
    !session.user?.id ||
    !session.user?.email
  ) {
    return false;
  }
  try {
    const result = await b.saveSession(
      session.access_token,
      session.refresh_token,
      session.user.id,
      session.user.email,
    );
    // Older bridges return void; the current bridge acknowledges persistence.
    return result !== false;
  } catch (e) {
    console.log("[SecureSession] saveSession lançou exceção:", e);
    return false;
  }
}

/**
 * Aciona o desbloqueio biométrico nativo. Resolve com o detail do evento
 * `AndroidSecureSessionResult`.
 */
let activeUnlock: Promise<AndroidSecureSessionResultDetail> | null = null;
export function unlockSecureSession(timeoutMs = 60_000): Promise<AndroidSecureSessionResultDetail> {
  if (activeUnlock) return activeUnlock;
  const task = requestSecureUnlock(timeoutMs);
  activeUnlock = task;
  void task.finally(() => { if (activeUnlock === task) activeUnlock = null; });
  return task;
}
function requestSecureUnlock(timeoutMs: number): Promise<AndroidSecureSessionResultDetail> {
  return new Promise((resolve) => {
    const b = getSecureSessionBridge();
    if (!b || typeof b.unlockSession !== "function") {
      resolve({ success: false, error: "Biometria segura indisponível neste aparelho." });
      return;
    }
    let settled = false;
    let correlated = false;
    const onResult = (event: Event) => {
      if (correlated) return;
      const detail = (event as CustomEvent<AndroidSecureSessionResultDetail>).detail ?? {};
      console.log("[SecureSession] resultado biometria:", detail.success);
      finish(detail);
    };
    const finish = (detail: AndroidSecureSessionResultDetail) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("AndroidSecureSessionResult", onResult as EventListener);
      clearTimeout(timer);
      resolve(detail);
    };
    const timer = setTimeout(
      () => finish({ success: false, error: "A biometria não respondeu. Tente novamente." }),
      timeoutMs,
    );
    window.addEventListener("AndroidSecureSessionResult", onResult as EventListener, {
      once: true,
    });
    try {
      const result = b.unlockSession();
      if (result && typeof result.then === "function") {
        correlated = true;
        void result.then(finish, () => finish({ success: false, error: "Não foi possível desbloquear. Tente novamente." }));
      }
    } catch (e) {
      console.log("[SecureSession] unlockSession lançou exceção:", e);
      finish({
        success: false,
        error: "Falha ao iniciar a biometria nativa.",
      });
    }
  });
}

/**
 * Fluxo completo de entrada via biometria segura:
 *  1. dispara unlockSession()
 *  2. aplica os tokens devolvidos em supabase.auth.setSession()
 *  3. confirma com getSession()
 *
 * Retorna a sessão restaurada ou null. Em caso de tokens inválidos, limpa
 * a sessão segura para forçar novo login por senha.
 */
const retryMessage = "Não foi possível verificar sua sessão agora. Confira a conexão e tente novamente. Seu acesso salvo foi preservado.";
const expiredMessage = "Sessão expirada. Entre com sua senha novamente para reativar a biometria.";
function invalidSession(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["refresh_token_not_found", "refresh_token_already_used", "session_not_found", "session_expired", "user_not_found", "user_banned"].includes(String(error.code));
}
export async function loginWithSecureSession(): Promise<{
  session: Session | null; error: string | null; warning?: string;
}> {
  const detail = await unlockSecureSession();
  if (detail.success !== true) return { session: null, error: detail.error || "Biometria não autorizada." };
  if (!detail.access_token || !detail.refresh_token) return { session: null, error: "Não foi possível recuperar o acesso salvo. Entre com sua senha." };
  try {
    const { error } = await supabase.auth.setSession({ access_token: detail.access_token, refresh_token: detail.refresh_token });
    if (error) {
      if (invalidSession(error)) await clearSecureSession();
      return { session: null, error: invalidSession(error) ? expiredMessage : retryMessage };
    }
    const { data, error: readError } = await supabase.auth.getSession();
    if (readError || !data.session) return { session: null, error: retryMessage };
    const saved = await saveSecureSession(data.session);
    return { session: data.session, error: null, ...(!saved ? { warning: "Você entrou, mas não foi possível atualizar o acesso seguro neste aparelho. Reative a entrada por biometria nas configurações." } : {}) };
  } catch (error) {
    if (invalidSession(error)) await clearSecureSession();
    return { session: null, error: invalidSession(error) ? expiredMessage : retryMessage };
  }
}
