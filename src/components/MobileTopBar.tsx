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
 * Header mobile estilo app financeiro:
 *   [☰]  [avatar] olá, Nome              [logo]  [🔔]
 * Visível apenas em <lg via `lg:hidden`.
 */
export function MobileTopBar() {
  const { t } = useTranslation("nav");
  const { user, profile } = useAuth();
  const { unreadCount } = useAlerts();

  const displayName =
    profile?.nome?.trim() ||
    profile?.responsavel_nome?.trim() ||
    (user?.email ? user.email.split("@")[0] : "") ||
    t("header.fallbackUser");
  const firstName = displayName.split(/\s+/)[0] || displayName;
  const initials = getInitials(profile?.nome ?? profile?.responsavel_nome, user?.email);

  return (
    <div className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur safe-top lg:hidden">
      <div className="mx-auto flex h-14 max-w-md items-center gap-2 px-3">
        {/* Hambúrguer */}
        <MobileMoreSheet
          trigger={
            <button
              type="button"
              aria-label={t("aria.openMore")}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-foreground active:scale-95"
            >
              <Menu className="h-5 w-5" />
            </button>
          }
        />

        {/* Avatar + saudação */}
        <Link
          to="/app/perfil"
          aria-label={t("aria.openProfile")}
          className="flex min-w-0 flex-1 items-center gap-2 active:scale-[0.98]"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-border/60 bg-muted text-[11px] font-bold text-foreground">
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
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-[10px] font-medium text-muted-foreground">olá,</span>
            <span className="block truncate text-sm font-bold tracking-tight">{firstName}</span>
          </span>
        </Link>

        {/* Logo discreto */}
        <Link
          to="/"
          aria-label="Gasto Inteligente"
          className="hidden shrink-0 items-center opacity-60 xs:flex"
        >
          <BrandMark className="h-5" />
        </Link>

        {/* Sino */}
        <Link
          to="/alertas"
          aria-label={t("aria.openAlerts")}
          className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground active:scale-95"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground ring-2 ring-background">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}
