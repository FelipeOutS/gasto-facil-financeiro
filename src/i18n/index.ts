import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ptCommon from "./locales/pt/common.json";
import ptLanding from "./locales/pt/landing.json";
import ptAuth from "./locales/pt/auth.json";
import ptAccount from "./locales/pt/account.json";
import ptNav from "./locales/pt/nav.json";
import ptDashboard from "./locales/pt/dashboard.json";
import ptGastos from "./locales/pt/gastos.json";
import ptCartoes from "./locales/pt/cartoes.json";
import ptContasAPagar from "./locales/pt/contas-a-pagar.json";
import ptContasAReceber from "./locales/pt/contas-a-receber.json";
import ptCategorias from "./locales/pt/categorias.json";
import ptClientes from "./locales/pt/clientes.json";
import ptFornecedores from "./locales/pt/fornecedores.json";
import ptMetas from "./locales/pt/metas.json";
import ptOrcamento from "./locales/pt/orcamento.json";
import ptRelatorios from "./locales/pt/relatorios.json";
import ptAdicionar from "./locales/pt/adicionar.json";
import ptGuardado from "./locales/pt/guardado.json";
import ptRenda from "./locales/pt/renda.json";
import ptAssinaturas from "./locales/pt/assinaturas.json";
import ptMeuPlano from "./locales/pt/meu-plano.json";
import ptPerfil from "./locales/pt/perfil.json";
import ptEmpresa from "./locales/pt/empresa.json";
import ptOnboarding from "./locales/pt/onboarding.json";
import ptConfirmar from "./locales/pt/confirmar.json";
import ptLegal from "./locales/pt/legal.json";
import ptMisc from "./locales/pt/misc.json";
import ptImportConta from "./locales/pt/import-conta.json";
import ptImportFatura from "./locales/pt/import-fatura.json";
import ptImportExtrato from "./locales/pt/import-extrato.json";
import ptImportInvestimentos from "./locales/pt/import-investimentos.json";
import ptExtratosImportados from "./locales/pt/extratos-importados.json";
import ptMercado from "./locales/pt/mercado.json";
import ptCofre from "./locales/pt/cofre.json";

import enCommon from "./locales/en/common.json";
import enLanding from "./locales/en/landing.json";
import enAuth from "./locales/en/auth.json";
import enAccount from "./locales/en/account.json";
import enNav from "./locales/en/nav.json";
import enDashboard from "./locales/en/dashboard.json";
import enGastos from "./locales/en/gastos.json";
import enCartoes from "./locales/en/cartoes.json";
import enContasAPagar from "./locales/en/contas-a-pagar.json";
import enContasAReceber from "./locales/en/contas-a-receber.json";
import enCategorias from "./locales/en/categorias.json";
import enClientes from "./locales/en/clientes.json";
import enFornecedores from "./locales/en/fornecedores.json";
import enMetas from "./locales/en/metas.json";
import enOrcamento from "./locales/en/orcamento.json";
import enRelatorios from "./locales/en/relatorios.json";
import enAdicionar from "./locales/en/adicionar.json";
import enGuardado from "./locales/en/guardado.json";
import enRenda from "./locales/en/renda.json";
import enAssinaturas from "./locales/en/assinaturas.json";
import enMeuPlano from "./locales/en/meu-plano.json";
import enPerfil from "./locales/en/perfil.json";
import enEmpresa from "./locales/en/empresa.json";
import enOnboarding from "./locales/en/onboarding.json";
import enConfirmar from "./locales/en/confirmar.json";
import enLegal from "./locales/en/legal.json";
import enMisc from "./locales/en/misc.json";
import enImportConta from "./locales/en/import-conta.json";
import enImportFatura from "./locales/en/import-fatura.json";
import enImportExtrato from "./locales/en/import-extrato.json";
import enImportInvestimentos from "./locales/en/import-investimentos.json";
import enExtratosImportados from "./locales/en/extratos-importados.json";
import enMercado from "./locales/en/mercado.json";
import enCofre from "./locales/en/cofre.json";

export const SUPPORTED_LOCALES = ["pt", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt";
export const LANG_STORAGE_KEY = "gi-lang";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Detects the initial language. Para evitar hydration mismatch entre SSR e cliente,
 * usamos APENAS sinais que existem nos dois lados (URL search `?lang=` ou prefixo de rota).
 * O fallback do localStorage / navigator é aplicado depois da hidratação pelo hook useLocale.
 */
function detectInitialLocale(): Locale {
  try {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const fromUrl = url.searchParams.get("lang");
      if (isLocale(fromUrl)) return fromUrl;
      const seg = url.pathname.split("/").filter(Boolean)[0];
      if (isLocale(seg)) return seg;
    }
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE;
}

const resources = {
  pt: { common: ptCommon, landing: ptLanding, auth: ptAuth, account: ptAccount, nav: ptNav, dashboard: ptDashboard, gastos: ptGastos, cartoes: ptCartoes, "contas-a-pagar": ptContasAPagar, "contas-a-receber": ptContasAReceber, categorias: ptCategorias, clientes: ptClientes, fornecedores: ptFornecedores, metas: ptMetas, orcamento: ptOrcamento, relatorios: ptRelatorios, adicionar: ptAdicionar, guardado: ptGuardado, renda: ptRenda, assinaturas: ptAssinaturas, "meu-plano": ptMeuPlano, perfil: ptPerfil, empresa: ptEmpresa, onboarding: ptOnboarding, confirmar: ptConfirmar, legal: ptLegal, misc: ptMisc, "import-conta": ptImportConta, "import-fatura": ptImportFatura, "import-extrato": ptImportExtrato, "extratos-importados": ptExtratosImportados, mercado: ptMercado, cofre: ptCofre },
  en: { common: enCommon, landing: enLanding, auth: enAuth, account: enAccount, nav: enNav, dashboard: enDashboard, gastos: enGastos, cartoes: enCartoes, "contas-a-pagar": enContasAPagar, "contas-a-receber": enContasAReceber, categorias: enCategorias, clientes: enClientes, fornecedores: enFornecedores, metas: enMetas, orcamento: enOrcamento, relatorios: enRelatorios, adicionar: enAdicionar, guardado: enGuardado, renda: enRenda, assinaturas: enAssinaturas, "meu-plano": enMeuPlano, perfil: enPerfil, empresa: enEmpresa, onboarding: enOnboarding, confirmar: enConfirmar, legal: enLegal, misc: enMisc, "import-conta": enImportConta, "import-fatura": enImportFatura, "import-extrato": enImportExtrato, "extratos-importados": enExtratosImportados, mercado: enMercado, cofre: enCofre },
};

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: detectInitialLocale(),
    fallbackLng: DEFAULT_LOCALE,
    defaultNS: "common",
    ns: ["common", "landing", "auth", "account", "nav", "dashboard", "gastos", "cartoes", "contas-a-pagar", "contas-a-receber", "categorias", "clientes", "fornecedores", "metas", "orcamento", "relatorios", "adicionar", "guardado", "renda", "assinaturas", "meu-plano", "perfil", "empresa", "onboarding", "confirmar", "legal", "misc", "import-conta", "import-fatura", "import-extrato", "extratos-importados", "mercado", "cofre"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

export default i18n;
