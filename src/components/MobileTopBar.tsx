import { Link } from "@tanstack/react-router";
import { Bell, Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth-context";
import { useAlerts } from "@/lib/alerts/use-alerts";
import { MobileMoreSheet } from "@/components/MobileMoreSheet";

function getInitials(name?: string | null, email?: string | null) {
  const src = (name && name.trim()) || (email && email.split("@")[0]) || "U";
  const parts = src.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Header mobile estilo app financeiro premium:
 *   [☰]               [LOGO]               [🔔] [avatar]
 *
 * Layout limpo, sem textos longos no topo, com a marca em destaque
 * centralizada — visual de aplicativo real (não dashboard web).
 * Visível apenas em <lg via `lg:hidden`.
 */
export function MobileTopBar() {
  const { t } = useTranslation("nav");
  const { user, profile } = useAuth();
  const { unreadCount } = useAlerts();

  const initials = getInitials(profile?.nome ?? profile?.responsavel_nome, user?.email);

  return (
    <div className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur safe-top lg:hidden">
      <div className="mx-auto grid h-14 max-w-md grid-cols-[auto_1fr_auto] items-center gap-2 px-3 md:h-16 md:max-w-3xl md:gap-4 md:px-6">
        {/* Esquerda — Hambúrguer */}
        <MobileMoreSheet
          trigger={
            <button
              type="button"
              aria-label={t("aria.openMore")}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-foreground transition active:scale-95 hover:bg-muted/60"
            >
              <Menu className="h-5 w-5" />
            </button>
          }
        />

        {/* Centro — Logo da marca */}
        <Link
          to="/"
          aria-label="Gasto Inteligente"
          className="flex items-center justify-center active:scale-[0.98]"
        >
          <BrandMark className="h-6 w-auto md:h-7" />
        </Link>

        {/* Direita — Sino + Avatar */}
        <div className="flex items-center gap-1">
          <Link
            to="/alertas"
            aria-label={
              unreadCount > 0
                ? `${t("aria.openAlerts")} (${unreadCount > 9 ? "9+" : unreadCount})`
                : t("aria.openAlerts")
            }
            className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition active:scale-95 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {unreadCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute right-1 top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground ring-2 ring-background"
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Link>

          <Link
            to="/app/perfil"
            aria-label={t("aria.openProfile")}
            className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-border/60 bg-muted text-[11px] font-bold text-foreground transition active:scale-95"
          >
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile?.nome ?? t("aria.avatarAlt")}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <span>{initials}</span>
            )}
          </Link>
        </div>
      </div>
    </div>
  );
}
