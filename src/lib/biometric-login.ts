// Entrada por biometria nativa (Android WebView) na tela de login.
//
// Diferente do "app lock" (que protege uma sessão já aberta), aqui o
// objetivo é evitar que o usuário digite e-mail/senha toda vez. Não
// armazenamos credenciais — apenas uma flag local indicando que este
// aparelho pode usar a biometria para autorizar o uso da sessão Supabase
// já persistida (refresh token gerenciado pelo próprio SDK).
//
// Chaves locais:
//  - app_android_biometric_login_enabled = "true"
//  - app_android_biometric_user_email    = "<email>"

export const LOGIN_BIO_ENABLED_KEY = "app_android_biometric_login_enabled";
export const LOGIN_BIO_EMAIL_KEY = "app_android_biometric_user_email";

type AndroidBiometricResultDetail = {
  success?: boolean;
  error?: string;
  errorCode?: string | number;
};

function getBridge(): NonNullable<Window["AndroidBiometric"]> | null {
  if (typeof window === "undefined") return null;
  const b = window.AndroidBiometric;
  return b && typeof b.authenticate === "function" ? b : null;
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

export function getLoginBioEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LOGIN_BIO_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function clearLoginBio(): void {
  try {
    window.localStorage.removeItem(LOGIN_BIO_ENABLED_KEY);
    window.localStorage.removeItem(LOGIN_BIO_EMAIL_KEY);
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
    if (!b?.authenticate) {
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
      b.authenticate();
    } catch (e) {
      console.log("[LoginBio] erro ao chamar authenticate:", e);
      finish({ success: false, error: "Falha ao iniciar a biometria nativa." });
    }
  });
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
  try {
    window.localStorage.setItem(LOGIN_BIO_ENABLED_KEY, "true");
    if (email) window.localStorage.setItem(LOGIN_BIO_EMAIL_KEY, email);
  } catch {
    throw new Error("Falha ao salvar a configuração local.");
  }
}
