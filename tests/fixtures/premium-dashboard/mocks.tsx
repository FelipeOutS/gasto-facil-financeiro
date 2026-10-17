import nav from "../../../src/i18n/locales/pt/nav.json";
import dashboard from "../../../src/i18n/locales/pt/dashboard.json";
import { planAllowsFeature } from "../../../src/lib/plans";
import type { Gasto, Receita } from "../../../src/lib/types";
export function useTranslation(namespace = "nav") {
  return {
    t: (key: string, params?: Record<string, unknown>) => {
      let value: any = key
        .split(".")
        .reduce((v: any, k) => v?.[k], namespace === "dashboard" ? dashboard : nav);
      if (typeof value !== "string") return key;
      return value.replace(/{{(\w+)}}/g, (_: string, k: string) => String(params?.[k] ?? ""));
    },
    i18n: { language: "pt", resolvedLanguage: "pt" },
  };
}
export const useAuth = () => ({
  profile: { nome: "Marina Souza", tipo_cadastro: "pessoa_fisica" },
  user: { id: "isolated-premium-fixture", email: "teste@example.invalid" },
});
export const usePlan = () => ({
  can: (feature: any) => planAllowsFeature("pessoal_premium", feature),
  isAdminMaster: false,
});
export const startTrial = async () => ({ ok: false });
export const useSubscriptionGuard = () => ({ canWriteBasic: true, requireSubscription: () => {} });
export const useAlertaContas = () => "nenhum";
export const PRODUCT_EVENTS = { navClick: "nav_click" };
export const trackProductEvent = () => {};
export const AuthGate = ({ children }: any) => children;
export const ExpiredAccessBanner = () => null;
export const ConnectedAccountSwitcher = () => null;
export const MobileNotificationsFab = () => null;
export const getCategoriaById = () => ({
  id: "alimentacao",
  nome: "Alimentação",
  iconName: "Utensils",
  colorHex: "#15996a",
});
export const gastos: Gasto[] = Array.from(
  { length: 6 },
  (_, i) =>
    ({
      id: `test-${i}`,
      descricao: i % 2 ? "Compras da semana" : "Almoço",
      estabelecimento: "",
      valor: 1200 + i * 500,
      data: `2026-${String(5 + i).padStart(2, "0")}-14`,
      mes: 5 + i,
      ano: 2026,
      categoriaId: "alimentacao",
      formaPagamento: "pix",
      tipoGasto: "avulso",
      confirmado: true,
      criadoEm: "2026-01-01",
      atualizadoEm: "2026-01-01",
    }) as Gasto,
);
export const receitas: Receita[] = Array.from(
  { length: 6 },
  (_, i) =>
    ({
      id: `revenue-${i}`,
      descricao: "Receita de teste",
      valor: 7000 + i * 1000,
      data: `2026-${String(5 + i).padStart(2, "0")}-05`,
      mes: 5 + i,
      ano: 2026,
      tipo: "outros",
      recorrente: false,
      criadoEm: "2026-01-01",
      atualizadoEm: "2026-01-01",
    }) as Receita,
);
