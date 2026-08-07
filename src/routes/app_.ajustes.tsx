import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  User,
  Sun,
  PieChart,
  Bell,
  ShieldCheck,
  Plug,
  Crown,
  HelpCircle,
  ChevronRight,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { SettingsPageHeader } from "@/components/SettingsPageHeader";

export const Route = createFileRoute("/app_/ajustes")({
  head: () => ({ meta: [{ title: "Ajustes — Gasto Inteligente" }] }),
  component: AjustesPage,
});

function AjustesPage() {
  const { t } = useTranslation("settings");

  const sections = [
    { id: "account", label: t("sections.account.title"), desc: t("sections.account.description"), icon: User, to: "/conta", params: { from: "ajustes" } },
    { id: "appearance", label: t("sections.appearance.title"), desc: t("sections.appearance.description"), icon: Sun, to: "/app/ajustes/aparencia" },
    { id: "finance", label: t("sections.finance.title"), desc: t("sections.finance.description"), icon: PieChart, to: "/app/ajustes/preferencias-financeiras" },
    { id: "notifications", label: t("sections.notifications.title"), desc: t("sections.notifications.description"), icon: Bell, to: "/app/ajustes/notificacoes" },
    { id: "privacy", label: t("sections.privacy.title"), desc: t("sections.privacy.description"), icon: ShieldCheck, to: "/app/privacidade" },
    { id: "connections", label: t("sections.connections.title"), desc: t("sections.connections.description"), icon: Plug, to: "/contas-conectadas", params: { from: "ajustes" } },
    { id: "plan", label: t("sections.plan.title"), desc: t("sections.plan.description"), icon: Crown, to: "/meu-plano", params: { from: "ajustes" } },
    { id: "help", label: t("sections.help.title"), desc: t("sections.help.description"), icon: HelpCircle, to: "/app/ajustes/ajuda" },
  ];

  return (
    <MobileShell>
      <SettingsPageHeader title="Ajustes" description="Personalize sua experiência." backTo="/app" />
      <div className="grid gap-3">
        {sections.map((s) => (
          <Link
            key={s.id}
            to={s.to as any}
            search={s.params}
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

