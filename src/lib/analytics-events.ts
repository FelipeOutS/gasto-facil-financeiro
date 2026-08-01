/**
 * Eventos de Analytics (dataLayer / GTM).
 *
 * Regras invioláveis:
 * - só executa no navegador;
 * - só faz push quando o visitante autorizou a categoria Analytics
 *   (estado real lido do cookie de consentimento já existente);
 * - NUNCA carrega o GTM por conta própria;
 * - nenhum dado pessoal, financeiro ou parâmetro extra é enviado;
 * - nada é enfileirado para envio posterior caso o consentimento não exista.
 */

import { CONSENT_COOKIE_NAME, parsePreferences } from "./cookie-consent";

type DataLayerWindow = Window & { dataLayer?: unknown[] };

/** Marcador de disparo único por cadastro (aba atual). */
const SIGN_UP_ONCE_KEY = "gi_analytics_sign_up_sent";

let signUpSentInThisPageLoad = false;

function readConsentCookie(): { analytics: boolean } | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CONSENT_COOKIE_NAME}=`));
  if (!raw) return null;
  return parsePreferences(decodeURIComponent(raw.slice(CONSENT_COOKIE_NAME.length + 1)));
}

/** true somente quando existe escolha salva com Analytics autorizado. */
export function analyticsAllowed(): boolean {
  if (typeof window === "undefined") return false;
  return readConsentCookie()?.analytics === true;
}

function pushEvent(event: string) {
  const w = window as DataLayerWindow;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ event });
}

/**
 * Dispara `sign_up` — apenas após confirmação real de criação de conta.
 * Idempotente: no máximo um disparo por cadastro bem-sucedido.
 */
export function trackSignUpCompleted(): void {
  if (typeof window === "undefined") return;
  if (signUpSentInThisPageLoad) return;

  try {
    if (window.sessionStorage.getItem(SIGN_UP_ONCE_KEY) === "1") {
      signUpSentInThisPageLoad = true;
      return;
    }
  } catch {
    /* sessionStorage indisponível — a guarda em memória basta */
  }

  signUpSentInThisPageLoad = true;
  try {
    window.sessionStorage.setItem(SIGN_UP_ONCE_KEY, "1");
  } catch {
    /* ignore */
  }

  if (!analyticsAllowed()) return; // sem consentimento: não envia e não guarda
  pushEvent("sign_up");
}

/** Uso exclusivo em testes. */
export function __resetAnalyticsEventsForTests(): void {
  signUpSentInThisPageLoad = false;
  try {
    window.sessionStorage.removeItem(SIGN_UP_ONCE_KEY);
  } catch {
    /* ignore */
  }
}
