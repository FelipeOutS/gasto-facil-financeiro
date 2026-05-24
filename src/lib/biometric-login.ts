// Entrada por biometria nativa (Android WebView) na tela de login.
//
// Diferente do "app lock" (que protege uma sessão já aberta), aqui o
// objetivo é evitar que o usuário digite e-mail/senha toda vez. Não
// armazenamos credenciais — apenas uma flag local indicando que este
// aparelho pode usar a biometria para autorizar o uso da sessão Supabase
// já persistida (refresh token gerenciado pelo próprio SDK).
//
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Chaves locais/sessão:
//  - app_android_biometric_login_enabled = "true"
//  - app_android_biometric_user_email    = "<email>"
//  - app_android_biometric_user:<email>  = "true"
//  - app_android_biometric_session       = tokens da sessão atual
//  - gi:biometric-unlocked               = "true" (sessionStorage)
//  - gi:biometric-auth-in-progress       = "true" (sessionStorage)

export const LOGIN_BIO_ENABLED_KEY = "app_android_biometric_login_enabled";
export const LOGIN_BIO_EMAIL_KEY = "app_android_biometric_user_email";
export const LOGIN_BIO_SESSION_KEY = "app_android_biometric_session";
export const LOGIN_BIO_UNLOCKED_KEY = "gi:biometric-unlocked";
export const LOGIN_BIO_IN_PROGRESS_KEY = "gi:biometric-auth-in-progress";

type PersistedLoginBioSession = {
  v: 1;
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user_id?: string;
  email?: string;
  saved_at: number;
};

function userEnabledKey(email: string) {
  return `app_android_biometric_user:${email.trim().toLowerCase()}`;
}

type AndroidBiometricResultDetail = {
  success?: boolean;
  error?: string;
  errorCode?: string | number;
};

function getBridge(): NonNullable<Window["AndroidBiometric"]> | null {
  if (typeof window === "undefined") return null;
  const b = window.AndroidBiometric;
  return b && (typeof b.requestAuthentication === "function" || typeof b.authenticate === "function") ? b : null;
}

export function isLoginBioBridgeAvailable(): boolean {
  return getBridge() !== null;
}

export function isLoginBioEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LOGIN_BIO_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function isLoginBioEnabledForEmail(email: string | null | undefined): boolean {
  if (typeof window === "undefined" || !email) return false;
  try {
    return window.localStorage.getItem(userEnabledKey(email)) === "true";
  } catch {
    return false;
  }
}

export function isLoginBioUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(LOGIN_BIO_UNLOCKED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setLoginBioUnlocked(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(LOGIN_BIO_UNLOCKED_KEY, "true");
    else window.sessionStorage.removeItem(LOGIN_BIO_UNLOCKED_KEY);
  } catch {
    /* ignore */
  }
}

export function isLoginBioInProgress(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(LOGIN_BIO_IN_PROGRESS_KEY) === "true";
  } catch {
    return false;
  }
}

export function isLoginBioUnlockRequired(): boolean {
  return isLoginBioBridgeAvailable() && isLoginBioEnabled() && !isLoginBioUnlocked() && !isLoginBioInProgress();
}

export function setLoginBioInProgress(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(LOGIN_BIO_IN_PROGRESS_KEY, "true");
    else window.sessionStorage.removeItem(LOGIN_BIO_IN_PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}

export function getLoginBioEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LOGIN_BIO_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function persistLoginBioSession(session: Session | null | undefined): boolean {
  if (typeof window === "undefined" || !session?.access_token || !session.refresh_token) return false;
  try {
    const email = session.user?.email?.trim().toLowerCase() ?? "";
    const payload: PersistedLoginBioSession = {
      v: 1,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      user_id: session.user?.id,
      email,
      saved_at: Date.now(),
    };
    window.localStorage.setItem(LOGIN_BIO_SESSION_KEY, JSON.stringify(payload));
    window.localStorage.setItem(LOGIN_BIO_ENABLED_KEY, "true");
    if (email) {
      window.localStorage.setItem(LOGIN_BIO_EMAIL_KEY, email);
      window.localStorage.setItem(userEnabledKey(email), "true");
    }
    return true;
  } catch {
    return false;
  }
}

export function getPersistedLoginBioSession(): PersistedLoginBioSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOGIN_BIO_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedLoginBioSession>;
    if (parsed.v !== 1 || !parsed.access_token || !parsed.refresh_token) return null;
    return parsed as PersistedLoginBioSession;
  } catch {
    return null;
  }
}

export function clearPersistedLoginBioSession(): void {
  try {
    window.localStorage.removeItem(LOGIN_BIO_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function clearLoginBio(): void {
  try {
    const email = window.localStorage.getItem(LOGIN_BIO_EMAIL_KEY);
    if (email) window.localStorage.removeItem(userEnabledKey(email));
    window.localStorage.removeItem(LOGIN_BIO_ENABLED_KEY);
    window.localStorage.removeItem(LOGIN_BIO_EMAIL_KEY);
    clearPersistedLoginBioSession();
    setLoginBioUnlocked(false);
    setLoginBioInProgress(false);
  } catch {
    /* ignore */
  }
}

/**
 * Aciona a biometria nativa e resolve quando o evento
 * `AndroidBiometricResult` chegar. A bridge é event-driven e não
 * retorna Promise.
 */
export function runLoginBiometric(timeoutMs = 60_000): Promise<AndroidBiometricResultDetail> {
  return new Promise((resolve) => {
    const b = getBridge();
    if (!b || (typeof b.requestAuthentication !== "function" && typeof b.authenticate !== "function")) {
      resolve({ success: false, error: "Biometria nativa indisponível neste aparelho." });
      return;
    }
    let settled = false;
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AndroidBiometricResultDetail>).detail ?? {};
      console.log("[LoginBio] AndroidBiometricResult:", detail);
      finish(detail);
    };
    const finish = (detail: AndroidBiometricResultDetail) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("AndroidBiometricResult", onResult as EventListener);
      clearTimeout(timer);
      resolve(detail);
    };
    const timer = setTimeout(
      () => finish({ success: false, error: "A biometria não respondeu. Tente novamente." }),
      timeoutMs,
    );
    window.addEventListener("AndroidBiometricResult", onResult as EventListener, { once: true });
    try {
      if (typeof b.requestAuthentication === "function") b.requestAuthentication("Entrar com biometria");
      else if (typeof b.authenticate === "function") b.authenticate("Entrar com biometria");
      else finish({ success: false, error: "Biometria nativa indisponível neste aparelho." });
    } catch (e) {
      console.log("[LoginBio] erro ao chamar authenticate:", e);
      finish({ success: false, error: "Falha ao iniciar a biometria nativa." });
    }
  });
}

export async function restoreLoginBioSessionAfterBiometric(): Promise<{
  session: Session | null;
  userId: string | null;
}> {
  async function restoreFromSavedToken(): Promise<Session | null> {
    const persisted = getPersistedLoginBioSession();
    if (!persisted?.refresh_token) return null;
    console.log("[AndroidBiometricLogin] tentando restaurar sessão com refresh_token");
    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: persisted.access_token,
        refresh_token: persisted.refresh_token,
      });
      if (!error && data.session) {
        persistLoginBioSession(data.session);
        console.log("[AndroidBiometricLogin] sessão restaurada com sucesso");
        return data.session;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  const { data: current } = await supabase.auth.getSession();
  let session = current.session ?? null;
  console.log(
    session
      ? "[AndroidBiometricLogin] getSession encontrou sessão"
      : "[AndroidBiometricLogin] getSession não encontrou sessão",
  );

  if (!session) {
    session = await restoreFromSavedToken();
  }

  if (!session) {
    console.log("[AndroidBiometricLogin] falha final: sessão ausente/expirada");
    return { session: null, userId: null };
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    session = await restoreFromSavedToken();
    if (!session) {
      console.log("[AndroidBiometricLogin] falha final: sessão ausente/expirada");
      return { session: null, userId: null };
    }
    const { data: restoredUserData, error: restoredUserErr } = await supabase.auth.getUser();
    if (restoredUserErr || !restoredUserData.user) {
      console.log("[AndroidBiometricLogin] falha final: sessão ausente/expirada");
      return { session: null, userId: null };
    }
    console.log("[AndroidBiometricLogin] getUser confirmado");
    persistLoginBioSession(session);
    return { session, userId: restoredUserData.user.id };
  }
  console.log("[AndroidBiometricLogin] getUser confirmado");
  persistLoginBioSession(session);
  return { session, userId: userData.user.id };
}

/**
 * Pede biometria e, se aprovada, marca este dispositivo como autorizado
 * a usar entrada rápida para o e-mail informado.
 */
export async function enableLoginBio(email: string): Promise<void> {
  if (!getBridge()) throw new Error("Biometria nativa indisponível neste aparelho.");
  const r = await runLoginBiometric();
  if (r.success !== true) {
    throw new Error(r.error || "Não foi possível ativar a biometria.");
  }
  const { data } = await supabase.auth.getSession();
  if (!persistLoginBioSession(data.session)) {
    throw new Error("Não foi possível salvar a sessão para entrada por biometria.");
  }
  try {
    window.localStorage.setItem(LOGIN_BIO_ENABLED_KEY, "true");
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail) {
      window.localStorage.setItem(LOGIN_BIO_EMAIL_KEY, normalizedEmail);
      window.localStorage.setItem(userEnabledKey(normalizedEmail), "true");
    }
  } catch {
    throw new Error("Falha ao salvar a configuração local.");
  }
}
