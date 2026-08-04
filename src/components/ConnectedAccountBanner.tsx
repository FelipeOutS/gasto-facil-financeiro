/**
 * Banner fixo que aparece no topo quando o usuário está vendo dados de
 * uma conta conectada (não a própria). Deixa claro de quem é a conta e
 * qual o nível de acesso, e oferece um botão para voltar para a própria.
 */
import { Eye, ArrowLeftRight } from "lucide-react";
import { useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useActiveAccount } from "@/lib/active-account";

// Rotas em que NÃO mostramos o banner (são pessoais e voltam à conta própria
// automaticamente — banner ficaria redundante).
const HIDDEN_ROUTES = new Set([
  "/login",
  "/cadastro",

  "/onboarding",
  "/recuperar-senha",
  "/reset-password",
  "/confirmar",
]);

export function ConnectedAccountBanner() {
  const { t } = useTranslation("dashboard");
  const { isOwnAccount, activeConnection, switchTo } = useActiveAccount();
  const location = useLocation();

  if (isOwnAccount || !activeConnection) return null;
  if (HIDDEN_ROUTES.has(location.pathname)) return null;
  if (location.pathname.startsWith("/aceitar-convite")) return null;

  const nome = activeConnection.nickname || activeConnection.email;
  const nivel = t(`connectedBanner.access.${activeConnection.accessLevel}`, {
    defaultValue: activeConnection.accessLevel,
  });

  return (
    <div className="sticky top-0 z-[60] w-full border-b border-amber-400/40 bg-amber-500/15 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-2 text-xs sm:text-sm">
        <div className="flex min-w-0 items-center gap-2 text-amber-900 dark:text-amber-100">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {t("connectedBanner.vendoConta")} <strong className="font-semibold">{nome}</strong>{" "}
            <span className="opacity-80">· {nivel}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => void switchTo(null)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-900/10 px-3 py-1 font-semibold text-amber-900 hover:bg-amber-900/20 dark:bg-amber-100/10 dark:text-amber-100 dark:hover:bg-amber-100/20"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          {t("connectedBanner.voltar")}
        </button>
      </div>
    </div>
  );
}
