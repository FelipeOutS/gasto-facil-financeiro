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
//  - gi:biometric-auth-in-progress       = timestamp em ms (sessionStorage)

export const LOGIN_BIO_ENABLED_KEY = "app_android_biometric_login_enabled";
export const LOGIN_BIO_EMAIL_KEY = "app_android_biometric_user_email";
export const LOGIN_BIO_SESSION_KEY = "app_android_biometric_session";
export const LOGIN_BIO_UNLOCKED_KEY = "gi:biometric-unlocked";
export const LOGIN_BIO_IN_PROGRESS_KEY = "gi:biometric-auth-in-progress";
export const LOGIN_BIO_SESSION_RESTORED_EVENT = "gi:login-bio-session-restored";

// As bridges nativas aguardam até 60 s. A margem adicional preserva uma
// autenticação realmente em andamento, mas impede que uma aba recarregada
// herde o marcador para sempre caso o fluxo nativo tenha sido interrompido.
const LOGIN_BIO_IN_PROGRESS_MAX_MS = 90_000;

const LEGACY_LOGIN_BIO_ENABLED_KEY = "biometric_enabled";
const LEGACY_LOGIN_BIO_EMAIL_KEY = "biometric_user_email";
const LEGACY_LOGIN_BIO_USER_ID_KEY = "biometric_user_id";
const LOGIN_BIO_USER_ID_KEY = "app_android_biometric_user_id";

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
  if (!b) return null;
  const hasAny =
    typeof b.requestAuthentication === "function" ||
    typeof b.authenticate === "function" ||
    typeof (b as { unlock?: unknown }).unlock === "function";
  return hasAny ? b : null;
}

export function isLoginBioBridgeAvailable(): boolean {
  return getBridge() !== null;
}

export function isLoginBioEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(LOGIN_BIO_ENABLED_KEY) === "true" ||
      window.localStorage.getItem(LEGACY_LOGIN_BIO_ENABLED_KEY) === "true"
    );
  } catch {
    return false;
  }
}

export function isLoginBioEnabledForEmail(email: string | null | undefined): boolean {
  if (typeof window === "undefined" || !email) return false;
  try {
    const normalized = email.trim().toLowerCase();
    return (
      window.localStorage.getItem(userEnabledKey(normalized)) === "true" ||
      (window.localStorage.getItem(LEGACY_LOGIN_BIO_ENABLED_KEY) === "true" &&
        window.localStorage.getItem(LEGACY_LOGIN_BIO_EMAIL_KEY)?.trim().toLowerCase() ===
          normalized)
    );
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
    const raw = window.sessionStorage.getItem(LOGIN_BIO_IN_PROGRESS_KEY);
    if (!raw) return false;

    const startedAt = Number(raw);
    const age = Date.now() - startedAt;
    if (Number.isFinite(startedAt) && startedAt > 0 && age >= 0 && age <= LOGIN_BIO_IN_PROGRESS_MAX_MS) {
      return true;
    }

    // Também remove o formato legado "true", que não possui prazo e podia
    // deixar rotas privadas presas indefinidamente após uma recarga.
    window.sessionStorage.removeItem(LOGIN_BIO_IN_PROGRESS_KEY);
    return false;
  } catch {
    return false;
  }
}

export function isLoginBioUnlockRequired(): boolean {
  return (
    isLoginBioBridgeAvailable() &&
    isLoginBioEnabled() &&
    !isLoginBioUnlocked() &&
    !isLoginBioInProgress()
  );
}

export function setLoginBioInProgress(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(LOGIN_BIO_IN_PROGRESS_KEY, String(Date.now()));
    else window.sessionStorage.removeItem(LOGIN_BIO_IN_PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}

export function getLoginBioEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      window.localStorage.getItem(LOGIN_BIO_EMAIL_KEY) ??
      window.localStorage.getItem(LEGACY_LOGIN_BIO_EMAIL_KEY)
    );
  } catch {
    return null;
  }
}

export function persistLoginBioSession(session: Session | null | undefined): boolean {
  if (typeof window === "undefined" || !session?.access_token || !session.refresh_token)
    return false;
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
    window.localStorage.setItem(LEGACY_LOGIN_BIO_ENABLED_KEY, "true");
    if (email) {
      window.localStorage.setItem(LOGIN_BIO_EMAIL_KEY, email);
      window.localStorage.setItem(LEGACY_LOGIN_BIO_EMAIL_KEY, email);
      window.localStorage.setItem(userEnabledKey(email), "true");
    }
    if (session.user?.id) {
      window.localStorage.setItem(LOGIN_BIO_USER_ID_KEY, session.user.id);
      window.localStorage.setItem(LEGACY_LOGIN_BIO_USER_ID_KEY, session.user.id);
    }
    return true;
  } catch {
    return false;
  }
}

export function notifyLoginBioSessionRestored(session: Session): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOGIN_BIO_SESSION_RESTORED_EVENT, { detail: { session } }));
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

export function clearLoginBioSessionOnly(): void {
  clearPersistedLoginBioSession();
  setLoginBioUnlocked(false);
  setLoginBioInProgress(false);
}

export function clearLoginBio(): void {
  try {
    const email = window.localStorage.getItem(LOGIN_BIO_EMAIL_KEY);
    if (email) window.localStorage.removeItem(userEnabledKey(email));
    window.localStorage.removeItem(LOGIN_BIO_ENABLED_KEY);
    window.localStorage.removeItem(LOGIN_BIO_EMAIL_KEY);
    window.localStorage.removeItem(LOGIN_BIO_USER_ID_KEY);
    window.localStorage.removeItem(LEGACY_LOGIN_BIO_ENABLED_KEY);
    window.localStorage.removeItem(LEGACY_LOGIN_BIO_EMAIL_KEY);
    window.localStorage.removeItem(LEGACY_LOGIN_BIO_USER_ID_KEY);
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
export function runLoginBiometric(
  timeoutMs = 60_000,
): Promise<AndroidBiometricResultDetail & { method?: string }> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve({ success: false, error: "Biometria indisponível neste ambiente." });
      return;
    }
    const bridge = (window as Window & { AndroidBiometric?: Record<string, unknown> })
      .AndroidBiometric;
    console.log("[AndroidBiometric] bridge disponível:", !!bridge);
    if (bridge) {
      try {
        console.log("[AndroidBiometric] métodos:", Object.keys(bridge));
      } catch {
        /* ignore */
      }
    }
    if (!bridge) {
      resolve({ success: false, error: "Biometria disponível apenas no aplicativo Android." });
      return;
    }
    const b = bridge as {
      requestAuthentication?: (...a: unknown[]) => void;
      authenticate?: (...a: unknown[]) => void;
      unlock?: (...a: unknown[]) => void;
    };
    const hasAny =
      typeof b.requestAuthentication === "function" ||
      typeof b.authenticate === "function" ||
      typeof b.unlock === "function";
    if (!hasAny) {
      resolve({ success: false, error: "Biometria indisponível neste dispositivo." });
      return;
    }

    let settled = false;
    let usedMethod = "";
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AndroidBiometricResultDetail>).detail ?? {};
      console.log("[Biometria] bridge result:", detail);
      console.log("[AndroidBiometric] resultado:", detail);
      finish({ ...detail, method: usedMethod });
    };
    const finish = (detail: AndroidBiometricResultDetail & { method?: string }) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("AndroidBiometricResult", onResult as EventListener);
      clearTimeout(timer);
      resolve(detail);
    };
    const timer = setTimeout(
      () =>
        finish({
          success: false,
          error: "A biometria não respondeu. Tente novamente.",
          method: usedMethod,
        }),
      timeoutMs,
    );
    window.addEventListener("AndroidBiometricResult", onResult as EventListener, { once: true });

    // Tenta chamar os métodos em ordem; se um lançar exceção sincrônica,
    // continua para o próximo. Chama sem argumentos — a bridge nativa não
    // aceita parâmetros e isso pode disparar erro do lado Android.
    const attempts: Array<{ name: string; fn?: (...a: unknown[]) => void }> = [
      { name: "requestAuthentication", fn: b.requestAuthentication },
      { name: "authenticate", fn: b.authenticate },
      { name: "unlock", fn: b.unlock },
    ];

    let invoked = false;
    let lastError: unknown = null;
    for (const a of attempts) {
      if (typeof a.fn !== "function") continue;
      try {
        console.log("[AndroidBiometric] chamando método:", a.name);
        usedMethod = a.name;
        a.fn.call(bridge);
        invoked = true;
        break;
      } catch (e) {
        lastError = e;
        console.log("[AndroidBiometric] método falhou:", a.name, e);
      }
    }
    if (!invoked) {
      console.log("[AndroidBiometric] nenhum método pôde ser invocado:", lastError);
      finish({ success: false, error: "Falha ao iniciar a biometria nativa.", method: usedMethod });
    }
  });
}

export async function restoreLoginBioSessionAfterBiometric(): Promise<{
  session: Session | null;
  userId: string | null;
}> {
  const hasValidSessionShape = (value: Session | null): value is Session =>
    !!value?.access_token && !!value.refresh_token && !!value.user?.id;

  async function refreshCurrentSession(): Promise<Session | null> {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      const refreshedSession = data.session ?? null;
      const refreshResult = {
        hasSession: !!refreshedSession,
        userId: refreshedSession?.user?.id ?? null,
        email: refreshedSession?.user?.email ?? null,
        error: error?.message ?? null,
      };
      console.log("[Biometria] refreshSession resultado:", refreshResult);
      if (!error && hasValidSessionShape(refreshedSession)) {
        persistLoginBioSession(refreshedSession);
        return refreshedSession;
      }
    } catch (error) {
      console.log("[Biometria] refreshSession resultado:", {
        hasSession: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }

  async function restoreFromSavedToken(): Promise<Session | null> {
    const persisted = getPersistedLoginBioSession();
    if (!persisted?.refresh_token) return null;
    console.log("[Biometria] tentando restaurar sessão com refresh_token");
    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: persisted.access_token,
        refresh_token: persisted.refresh_token,
      });
      if (!error && hasValidSessionShape(data.session ?? null)) {
        persistLoginBioSession(data.session);
        console.log("[Biometria] sessão restaurada com sucesso");
        return data.session;
      }
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({
        refresh_token: persisted.refresh_token,
      });
      const refreshResult = {
        hasSession: !!refreshed.session,
        userId: refreshed.session?.user?.id ?? null,
        email: refreshed.session?.user?.email ?? null,
        error: refreshError?.message ?? null,
      };
      console.log("[Biometria] refreshSession resultado:", refreshResult);
      if (!refreshError && hasValidSessionShape(refreshed.session ?? null)) {
        persistLoginBioSession(refreshed.session);
        console.log("[Biometria] sessão restaurada com sucesso");
        return refreshed.session;
      }
    } catch (error) {
      console.log("[Biometria] refreshSession resultado:", {
        hasSession: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }

  const { data: current } = await supabase.auth.getSession();
  let session = current.session ?? null;
  console.log("[Biometria] sessão após biometria:", !!session);
  console.log("[Biometria] usuário da sessão:", session?.user?.email);
  console.log(
    session
      ? "[AndroidBiometricLogin] getSession encontrou sessão"
      : "[AndroidBiometricLogin] getSession não encontrou sessão",
  );

  if (!hasValidSessionShape(session)) {
    session = await refreshCurrentSession();
  }

  if (!hasValidSessionShape(session)) {
    session = await restoreFromSavedToken();
    console.log("[Biometria] sessão após biometria:", !!session);
    console.log("[Biometria] usuário da sessão:", session?.user?.email);
  }

  if (!hasValidSessionShape(session)) {
    console.log("[AndroidBiometricLogin] falha final: sessão ausente/expirada");
    return { session: null, userId: null };
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    session = (await refreshCurrentSession()) ?? (await restoreFromSavedToken());
    if (!hasValidSessionShape(session)) {
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
  console.log("[EnableBiometric] started");
  const bridge = getBridge() as
    | (NonNullable<Window["AndroidBiometric"]> & { unlock?: (reason?: string) => void })
    | null;
  const bridgeExists = !!bridge;
  console.log("[EnableBiometric] Android bridge exists:", bridgeExists);

  if (typeof window === "undefined") {
    throw new Error("Biometria disponível apenas no aplicativo Android.");
  }
  if (!bridgeExists) {
    if (!window.AndroidBiometric) {
      throw new Error("Biometria disponível apenas no aplicativo Android.");
    }
    throw new Error("Biometria indisponível neste dispositivo.");
  }

  const r = await runLoginBiometric();
  console.log("[EnableBiometric] method used:", r.method);
  console.log("[EnableBiometric] biometric success:", r.success);

  if (r.success !== true) {
    const msg =
      r.error && r.error.trim().length > 0 ? r.error : "Autenticação biométrica cancelada.";
    console.log("[EnableBiometric] error:", msg);
    throw new Error(msg);
  }

  try {
    console.log(
      "[EnableBiometric] getSession exists:",
      typeof supabase.auth.getSession === "function",
    );
    console.log(
      "[EnableBiometric] refreshSession exists:",
      typeof supabase.auth.refreshSession === "function",
    );

    const { data: sessionData } = await supabase.auth.getSession();
    let session = sessionData.session ?? null;

    if (!session) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      session = refreshed.session ?? null;
    }

    if (
      !session ||
      !session.access_token ||
      !session.refresh_token ||
      !session.user?.id ||
      !session.user?.email
    ) {
      console.log("[EnableBiometric] access token exists:", !!session?.access_token);
      console.log("[EnableBiometric] refresh token exists:", !!session?.refresh_token);
      console.log("[EnableBiometric] user id:", session?.user?.id ?? null);
      const msg = "Sua sessão expirou. Faça login novamente para ativar a biometria.";
      console.log("[EnableBiometric] error:", msg);
      throw new Error(msg);
    }

    console.log("[EnableBiometric] access token exists:", true);
    console.log("[EnableBiometric] refresh token exists:", true);
    console.log("[EnableBiometric] user id:", session.user.id);

    const normalizedEmail = (session.user.email || email || "").trim().toLowerCase();
    if (!persistLoginBioSession(session)) {
      throw new Error("Não foi possível salvar a sessão para entrada por biometria.");
    }
    try {
      window.localStorage.setItem(LOGIN_BIO_ENABLED_KEY, "true");
      if (normalizedEmail) {
        window.localStorage.setItem(LOGIN_BIO_EMAIL_KEY, normalizedEmail);
        window.localStorage.setItem(userEnabledKey(normalizedEmail), "true");
      }
      window.localStorage.setItem("app_android_biometric_user_id", session.user.id);
    } catch {
      throw new Error("Falha ao salvar a configuração local.");
    }
    setLoginBioUnlocked(true);
    console.log("[EnableBiometric] saved biometric flags");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao ativar biometria.";
    console.log("[EnableBiometric] error:", msg);
    throw e instanceof Error ? e : new Error(msg);
  }
}
