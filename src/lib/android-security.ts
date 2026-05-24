// Integração com a bridge nativa Android `window.AndroidSecurity`.
// Bloqueia print, captura de tela e gravação de tela no Android WebView.
//
// Métodos esperados:
//  - enableSecureScreen()
//  - disableSecureScreen()
//  - isAvailable()

type AndroidSecurityBridge = {
  enableSecureScreen?: () => void;
  disableSecureScreen?: () => void;
  isAvailable?: () => boolean;
};

declare global {
  interface Window {
    AndroidSecurity?: AndroidSecurityBridge;
  }
}

function getBridge(): AndroidSecurityBridge | null {
  if (typeof window === "undefined") return null;
  return window.AndroidSecurity ?? null;
}

export function isAndroidSecurityAvailable(): boolean {
  const b = getBridge();
  if (!b) return false;
  try {
    if (typeof b.isAvailable === "function") {
      return !!b.isAvailable();
    }
    // Fallback: se o objeto existe, assumimos disponível
    return true;
  } catch {
    return false;
  }
}

export function enableSecureScreen(): void {
  const b = getBridge();
  if (!b || typeof b.enableSecureScreen !== "function") return;
  try {
    b.enableSecureScreen();
    console.log("[AndroidSecurity] secure screen enabled");
  } catch (e) {
    console.log("[AndroidSecurity] enableSecureScreen falhou:", e);
  }
}

export function disableSecureScreen(): void {
  const b = getBridge();
  if (!b || typeof b.disableSecureScreen !== "function") return;
  try {
    b.disableSecureScreen();
    console.log("[AndroidSecurity] secure screen disabled");
  } catch (e) {
    console.log("[AndroidSecurity] disableSecureScreen falhou:", e);
  }
}
