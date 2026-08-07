import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Bell, Smartphone, Mail, MessageSquare } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app_/ajustes/notificacoes")({
  head: () => ({ meta: [{ title: "Notificações — Gasto Inteligente" }] }),
  component: NotificacoesPage,
});

function NotificacoesPage() {
  const { t } = useTranslation("settings");

  const notificationGroups = [
    {
      title: t("notifications.groups.accounts"),
      items: [
        { id: "venceAmanha", label: t("notifications.options.venceAmanha"), active: true },
        { id: "venceHoje", label: t("notifications.options.venceHoje"), active: true },
        { id: "atrasada", label: t("notifications.options.atrasada"), active: true },
      ]
    },
    {
      title: t("notifications.groups.budget"),
      items: [
        { id: "pertoLimite", label: t("notifications.options.pertoLimite"), active: true },
        { id: "ultrapassouLimite", label: t("notifications.options.ultrapassouLimite"), active: true },
      ]
    },
    {
      title: t("notifications.groups.goals"),
      items: [
        { id: "metaAtingida", label: t("notifications.options.metaAtingida"), active: true },
        { id: "progressoMeta", label: t("notifications.options.progressoMeta"), active: false },
      ]
    },
    {
      title: t("notifications.groups.summaries"),
      items: [
        { id: "resumoMensal", label: t("notifications.options.resumoMensal"), active: false },
      ]
    }
  ];

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2 mb-6">
        <Link
          to="/app/ajustes"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("notifications.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("sections.notifications.description")}</p>
        </div>
      </header>

      <div className="space-y-8">
        {notificationGroups.map((group) => (
          <section key={group.title} className="space-y-3">
            <h2 className="text-xs font-bold tracking-widest text-muted-foreground uppercase px-1">
              {group.title}
            </h2>
            <div className="space-y-2">
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4 rounded-2xl border border-border bg-card"
                >
                  <span className="text-sm font-medium">{item.label}</span>
                  <Switch checked={item.active} disabled={!item.active} />
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className="space-y-3">
          <h2 className="text-xs font-bold tracking-widest text-muted-foreground uppercase px-1">
            Canais de Notificação
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "No app", icon: Smartphone, active: true },
              { label: "E-mail", icon: Mail, active: true },
              { label: "Push", icon: Bell, active: false, badge: "Em breve" },
              { label: "WhatsApp", icon: MessageSquare, active: false, badge: "Em breve" },
            ].map((canal) => (
              <div
                key={canal.label}
                className={cn(
                  "flex flex-col gap-3 p-4 rounded-2xl border border-border bg-card",
                  !canal.active && "opacity-60"
                )}
              >
                <div className="flex items-center justify-between">
                  <canal.icon className="h-5 w-5 text-brand" />
                  {canal.badge && (
                    <span className="text-[10px] font-bold bg-muted px-1.5 py-0.5 rounded uppercase">
                      {canal.badge}
                    </span>
                  )}
                </div>
                <span className="text-sm font-semibold">{canal.label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </MobileShell>
  );
}
