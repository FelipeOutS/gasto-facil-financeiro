export const useAlertaContas = () => "nenhum";
export const PRODUCT_EVENTS = { navClick: "nav_click" };
export function trackProductEvent() {}
import nav from "../../../src/i18n/locales/pt/nav.json";
export function useTranslation() {
  return {
    t: (key: string) => key.split(".").reduce((value: any, part) => value?.[part], nav) ?? key,
  };
}
