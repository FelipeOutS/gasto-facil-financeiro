import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth-context";
import { useAlerts } from "@/lib/alerts/use-alerts";

function getInitials(name?: string | null, email?: string | null) {
  const src = (name && name.trim()) || (email && email.split("@")[0]) || "U";
  const parts = src.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Barra superior fixa exibida apenas no modo mobile/app/WebView.
 * Mostra logo da marca, sino de notificações e avatar do usuário.
 * O avatar navega para a tela normal "Mais opções".
 */
export function MobileTopBar() {
  const { user, profile } = useAuth();
  const { unreadCount } = useAlerts();

  const initials = getInitials(profile?.nome ?? profile?.responsavel_nome, user?.email);

  return (
    <div className="sticky top-0 z-40 border-b border-border/60 bg-background/95 safe-top lg:hidden">
      <div className="mx-auto flex h-12 max-w-md items-center justify-between gap-3 px-4">
        <Link
          to="/"
          aria-label="Gasto Inteligente"
          className="flex items-center"
        >
          <BrandMark className="h-7" />
        </Link>
        <div className="flex items-center gap-1">
          <Link
            to="/alertas"
            aria-label="Abrir alertas"
            className="relative grid h-9 w-9 place-items-center rounded-full border border-border/60 bg-card/70 text-muted-foreground active:scale-95"
          >
            <Bell className="h-4.5 w-4.5" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold leading-none text-background ring-2 ring-background">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Link>
          <Link
            to="/app/perfil"
            aria-label="Abrir perfil"
            className="grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-border/60 bg-muted text-xs font-bold text-foreground active:scale-95"
          >
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile?.nome ?? "Avatar"}
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
