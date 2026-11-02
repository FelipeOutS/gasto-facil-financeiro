export const useAlertaContas = () => "nenhum";
export const PRODUCT_EVENTS = { navClick: "nav_click" };
export function trackProductEvent() {}
import nav from "../../../src/i18n/locales/pt/nav.json";
import dashboard from "../../../src/i18n/locales/pt/dashboard.json";
export function useTranslation(namespace = "nav") {
  return {
    t: (key: string) => key.split(".").reduce((value: any, part) => value?.[part], namespace === "dashboard" ? dashboard : nav) ?? key,
  };
}
