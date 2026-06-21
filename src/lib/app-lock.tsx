// Bloqueio do app por biometria nativa (Android WebView).
//
// Fluxo:
//  - Após login válido, o usuário pode ativar a biometria do dispositivo
//    nas configurações ("Mais"). Isso grava uma flag local
//    `app_android_biometric_enabled = "true"`.
//  - Em todo novo carregamento do app (ou ao retomar do background) com:
//      * Android WebView (window.AndroidBiometric presente),
//      * sessão Supabase válida,
//      * flag local ativa,
//    mostramos uma tela de bloqueio que chama
//    `window.AndroidBiometric.authenticate()` e libera o uso quando o
//    evento `AndroidBiometricResult` retornar `success: true`.
//  - A biometria NÃO substitui o login real; só atua como cadeado local
//    sobre uma sessão já autenticada. Logout / sessão expirada desbloqueia
//    automaticamente o overlay (deixa o app exibir /login).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Fingerprint, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { isLoginBioInProgress, isLoginBioUnlocked } from "@/lib/biometric-login";

export const APP_LOCK_STORAGE_KEY = "app_android_biometric_enabled";
export const APP_LOCKED_FLAG_KEY = "app_locked_by_biometric";

export function markAppLockedNow(): void {
  try {
    window.localStorage.setItem(APP_LOCKED_FLAG_KEY, "true");
  } catch {
    /* ignore */
  }
}
export function clearAppLockedFlag(): void {
  try {
    window.localStorage.removeItem(APP_LOCKED_FLAG_KEY);
  } catch {
    /* ignore */
  }
}
export function isAppLockedFlagSet(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(APP_LOCKED_FLAG_KEY) === "true";
  } catch {
    return false;
  }
}

type AndroidBiometricResultDetail = {
  success?: boolean;
  error?: string;
  errorCode?: string | number;
};

// Os tipos globais para window.AndroidBiometric / AndroidBiometricResult já
// são declarados em `src/lib/vault/quick-unlock.ts` (reutilizamos aqui).

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

export function isAppLockBridgeAvailable(): boolean {
  return getBridge() !== null;
}

export function isAppLockEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // IMPORTANTE: o cadeado biométrico do app é independente da
    // "entrada por biometria" usada na tela de login. Só ativa quando o
    // usuário explicitamente ligou "Bloquear app" nas configurações.
    // Caso contrário, após login por biometria o AppLockProvider dispararia
    // uma SEGUNDA prompt e, se cancelada, derrubaria a sessão (bug que
    // levava o usuário de volta para /login).
    return window.localStorage.getItem(APP_LOCK_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Aciona a biometria nativa do Android e resolve com o resultado do
 * evento `AndroidBiometricResult`. A bridge não retorna Promise.
 */
function runAndroidBiometric(timeoutMs = 60_000): Promise<AndroidBiometricResultDetail> {
  return new Promise((resolve) => {
    const b = getBridge();
    if (!b) {
      resolve({ success: false, error: "Biometria nativa indisponível neste aparelho." });
      return;
    }
    const bridge = b as NonNullable<Window["AndroidBiometric"]> & { unlock?: () => void };
    let settled = false;
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AndroidBiometricResultDetail>).detail ?? {};
      console.log("[AppLock] AndroidBiometricResult:", detail);
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
    const attempts: Array<{ name: string; fn?: () => void }> = [
      { name: "requestAuthentication", fn: bridge.requestAuthentication },
      { name: "authenticate", fn: bridge.authenticate },
      { name: "unlock", fn: bridge.unlock },
    ];
    let invoked = false;
    for (const attempt of attempts) {
      if (typeof attempt.fn !== "function") continue;
      try {
        attempt.fn.call(bridge);
        invoked = true;
        break;
      } catch (e) {
        console.log("[AppLock] erro ao chamar biometria:", attempt.name, e);
      }
    }
    if (!invoked) {
      finish({ success: false, error: "Falha ao iniciar a biometria nativa." });
    }
  });
}

export async function enableAppLock(): Promise<void> {
  if (!getBridge()) throw new Error("Biometria nativa indisponível neste aparelho.");
  const r = await runAndroidBiometric();
  if (r.success !== true) {
    throw new Error(r.error || "Não foi possível ativar a biometria.");
  }
  try {
    window.localStorage.setItem(APP_LOCK_STORAGE_KEY, "true");
  } catch {
    throw new Error("Falha ao salvar a configuração local.");
  }
}

export function disableAppLock(): void {
  try {
    window.localStorage.removeItem(APP_LOCK_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

type AppLockContextValue = {
  bridgeAvailable: boolean;
  enabled: boolean;
  locked: boolean;
  refreshEnabled: () => void;
  lockNow: () => void;
};

const AppLockContext = createContext<AppLockContextValue>({
  bridgeAvailable: false,
  enabled: false,
  locked: false,
  refreshEnabled: () => {},
  lockNow: () => {},
});

export function useAppLock() {
  return useContext(AppLockContext);
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { session, loading, signOut } = useAuth();
  const [bridgeAvailable, setBridgeAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const triggeredRef = useRef(false);

  const refreshEnabled = useCallback(() => {
    setEnabled(isAppLockEnabled());
  }, []);

  // Detecta bridge + flag inicial.
  useEffect(() => {
    setBridgeAvailable(isAppLockBridgeAvailable());
    setEnabled(isAppLockEnabled());
  }, []);

  // Bloqueia quando: bridge + sessão válida + (flag enabled OU flag "locked now").
  useEffect(() => {
    if (loading) return;
    if (!session) {
      // Sem sessão real: nada a desbloquear. Limpa flag para evitar
      // tela de bloqueio sem sessão (que cairia em loop).
      setLocked(false);
      triggeredRef.current = false;
      clearAppLockedFlag();
      return;
    }
    if (!bridgeAvailable) return;
    if (isLoginBioInProgress() || isLoginBioUnlocked()) {
      console.log("[AppLock] ignorado: entrada por biometria já validada nesta abertura");
      triggeredRef.current = true;
      setLocked(false);
      return;
    }
    const lockedNow = isAppLockedFlagSet();
    if ((enabled || lockedNow) && !triggeredRef.current) {
      console.log("[AppLock] travando app (enabled=%s, lockedNow=%s)", enabled, lockedNow);
      setLocked(true);
    }
  }, [loading, session, bridgeAvailable, enabled]);

  const lockNow = useCallback(() => {
    if (!bridgeAvailable) {
      console.log("[AppLock] lockNow ignorado: bridge indisponível");
      return;
    }
    markAppLockedNow();
    triggeredRef.current = false;
    setErrorMsg(null);
    setLocked(true);
  }, [bridgeAvailable]);

  // Re-bloqueia ao retomar do background (apenas quando o usuário deixou
  // o bloqueio automático ativo nas configurações).
  useEffect(() => {
    if (!bridgeAvailable || !enabled) return;
    function onVisibility() {
      if (document.visibilityState === "visible" && session) {
        triggeredRef.current = false;
        setLocked(true);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [bridgeAvailable, enabled, session]);

  const tryUnlock = useCallback(async () => {
    if (authenticating) return;
    setErrorMsg(null);
    setAuthenticating(true);
    const result = await runAndroidBiometric();
    setAuthenticating(false);
    if (result.success === true) {
      triggeredRef.current = true;
      clearAppLockedFlag();
      setLocked(false);
    } else {
      setErrorMsg(result.error || "Não foi possível validar a biometria.");
    }
  }, [authenticating]);

  // Dispara automaticamente assim que a tela de bloqueio aparece.
  useEffect(() => {
    if (locked && !authenticating && !errorMsg) {
      void tryUnlock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  const handleSignOut = useCallback(async () => {
    // "Entrar com senha" no overlay = sair de verdade e cair em /login.
    triggeredRef.current = true;
    clearAppLockedFlag();
    setLocked(false);
    try {
      await signOut();
    } catch {
      /* ignore */
    }
    try {
      window.location.assign("/login");
    } catch {
      /* ignore */
    }
  }, [signOut]);

  const value = useMemo<AppLockContextValue>(
    () => ({ bridgeAvailable, enabled, locked, refreshEnabled, lockNow }),
    [bridgeAvailable, enabled, locked, refreshEnabled, lockNow],
  );

  return (
    <AppLockContext.Provider value={value}>
      {children}
      {locked && (
        <LockScreen
          authenticating={authenticating}
          errorMsg={errorMsg}
          onRetry={tryUnlock}
          onSignOut={handleSignOut}
        />
      )}
    </AppLockContext.Provider>
  );
}

function LockScreen({
  authenticating,
  errorMsg,
  onRetry,
  onSignOut,
}: {
  authenticating: boolean;
  errorMsg: string | null;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-8 bg-background px-6"
      style={{
        minHeight: "100dvh",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <BrandMark variant="login" className="h-12 w-auto sm:h-14" />
        <div className="grid h-20 w-20 place-items-center rounded-full bg-brand-soft text-brand ring-1 ring-border/60">
          <Fingerprint className="h-10 w-10" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Desbloqueie com biometria</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            Use a biometria deste aparelho para continuar usando o Gasto Inteligente.
          </p>
        </div>
        {errorMsg && (
          <p className="max-w-xs rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMsg}
          </p>
        )}
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2">
        <Button onClick={onRetry} disabled={authenticating} className="w-full">
          <Fingerprint className="h-4 w-4" />
          {authenticating ? "Aguardando biometria…" : "Usar biometria"}
        </Button>
        <Button variant="outline" onClick={onSignOut} className="w-full">
          <LogOut className="h-4 w-4" />
          Entrar com senha
        </Button>
      </div>
    </div>
  );
}
