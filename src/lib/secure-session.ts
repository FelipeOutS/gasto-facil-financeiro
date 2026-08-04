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
  saveSession?: (accessToken: string, refreshToken: string, userId: string, email: string) => void;
  hasSession?: () => boolean;
  getSavedEmail?: () => string | null;
  unlockSession?: () => void;
  clearSession?: () => void;
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

export function clearSecureSession(): void {
  const b = getSecureSessionBridge();
  if (!b || typeof b.clearSession !== "function") return;
  try {
    b.clearSession();
  } catch {
    /* ignore */
  }
}

/**
 * Salva a sessão atual do Supabase no Android Keystore via bridge nativa.
 * Não salva senha. Não loga tokens.
 */
export function saveSecureSession(session: Session | null | undefined): boolean {
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
    b.saveSession(session.access_token, session.refresh_token, session.user.id, session.user.email);
    return true;
  } catch (e) {
    console.log("[SecureSession] saveSession lançou exceção:", e);
    return false;
  }
}

/**
 * Aciona o desbloqueio biométrico nativo. Resolve com o detail do evento
 * `AndroidSecureSessionResult`.
 */
export function unlockSecureSession(timeoutMs = 60_000): Promise<AndroidSecureSessionResultDetail> {
  return new Promise((resolve) => {
    const b = getSecureSessionBridge();
    if (!b || typeof b.unlockSession !== "function") {
      resolve({ success: false, error: "Biometria segura indisponível neste aparelho." });
      return;
    }
    let settled = false;
    const onResult = (event: Event) => {
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
      b.unlockSession();
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
export async function loginWithSecureSession(): Promise<{
  session: Session | null;
  error: string | null;
}> {
  const detail = await unlockSecureSession();
  if (detail.success !== true) {
    return { session: null, error: detail.error || "Biometria não autorizada." };
  }
  if (!detail.access_token || !detail.refresh_token) {
    clearSecureSession();
    return {
      session: null,
      error: "Sessão expirada. Entre com sua senha novamente para reativar a biometria.",
    };
  }
  try {
    const { error: setErr } = await supabase.auth.setSession({
      access_token: detail.access_token,
      refresh_token: detail.refresh_token,
    });
    if (setErr) {
      console.log("[SecureSession] setSession falhou:", setErr.message);
      clearSecureSession();
      return {
        session: null,
        error: "Sessão expirada. Entre com sua senha novamente para reativar a biometria.",
      };
    }
    const { data } = await supabase.auth.getSession();
    const session = data.session ?? null;
    console.log("[SecureSession] sessão restaurada:", !!session);
    if (!session) {
      clearSecureSession();
      return {
        session: null,
        error: "Sessão expirada. Entre com sua senha novamente para reativar a biometria.",
      };
    }
    // Re-salva para renovar a janela de validade após refresh interno.
    saveSecureSession(session);
    return { session, error: null };
  } catch (e) {
    console.log("[SecureSession] erro ao restaurar sessão:", e);
    clearSecureSession();
    return {
      session: null,
      error: "Sessão expirada. Entre com sua senha novamente para reativar a biometria.",
    };
  }
}
