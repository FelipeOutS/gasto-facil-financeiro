import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ChevronRight,
  User,
  Sun,
  PieChart,
  Bell,
  ShieldCheck,
  Plug,
  Crown,
  HelpCircle,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app_/ajustes")({
  head: () => ({ meta: [{ title: "Ajustes — Gasto Inteligente" }] }),
  component: AjustesPage,
});

function AjustesPage() {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();

  const sections = [
    { id: "account", label: t("sections.account.title"), desc: t("sections.account.description"), icon: User, to: "/conta" },
    { id: "appearance", label: t("sections.appearance.title"), desc: t("sections.appearance.description"), icon: Sun, to: "/ajustes/aparencia" },
    { id: "finance", label: t("sections.finance.title"), desc: t("sections.finance.description"), icon: PieChart, to: "/categorias" },
    { id: "notifications", label: t("sections.notifications.title"), desc: t("sections.notifications.description"), icon: Bell, to: "/ajustes/notificacoes" },
    { id: "privacy", label: t("sections.privacy.title"), desc: t("sections.privacy.description"), icon: ShieldCheck, to: "/app/privacidade" },
    { id: "connections", label: t("sections.connections.title"), desc: t("sections.connections.description"), icon: Plug, to: "/contas-conectadas" },
    { id: "plan", label: t("sections.plan.title"), desc: t("sections.plan.description"), icon: Crown, to: "/meu-plano" },
    { id: "help", label: t("sections.help.title"), desc: t("sections.help.description"), icon: HelpCircle, to: "/ajustes/ajuda" },
  ];

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2 mb-6">
        <button
          onClick={() => navigate({ to: "/app" })}
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ajustes</h1>
          <p className="text-sm text-muted-foreground">Personalize sua experiência.</p>
        </div>
      </header>

      <div className="grid gap-3">
        {sections.map((s) => (
          <Link
            key={s.id}
            to={s.to as any}
            className="flex items-center gap-4 rounded-3xl border border-border bg-card p-4 transition-all hover:border-brand/30 hover:bg-card-elevated"
          >
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-card-elevated">
              <s.icon className="h-6 w-6 text-brand" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{s.label}</p>
              <p className="text-xs text-muted-foreground truncate">{s.desc}</p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </MobileShell>
  );
}
