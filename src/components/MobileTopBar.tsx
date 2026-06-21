import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth-context";
import { MobileMoreSheet } from "@/components/MobileMoreSheet";

function getInitials(name?: string | null, email?: string | null) {
  const src = (name && name.trim()) || (email && email.split("@")[0]) || "U";
  const parts = src.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Header mobile minimalista com três áreas de mesma largura:
 *   [☰ 44px]           [ LOGO centralizado ]           [avatar 44px]
 *
 * O sino de notificações foi movido para um FAB dedicado (MobileNotificationsFab).
 * Visível apenas em <lg via `lg:hidden`.
 */
export function MobileTopBar() {
  const { t } = useTranslation("nav");
  const { user, profile } = useAuth();

  const initials = getInitials(profile?.nome ?? profile?.responsavel_nome, user?.email);

  return (
    <div className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur safe-top lg:hidden">
      <div className="mx-auto grid h-14 max-w-md grid-cols-[44px_1fr_44px] items-center px-3 md:h-16 md:max-w-3xl md:px-6">
        {/* Esquerda — Hambúrguer (44x44 clicável) */}
        <MobileMoreSheet
          trigger={
            <button
              type="button"
              aria-label={t("aria.openMore")}
              className="grid h-11 w-11 place-items-center rounded-full text-foreground transition active:scale-95 hover:bg-muted/60"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          }
        />

        {/* Centro — Logo da marca, realmente centralizado */}
        <Link
          to="/"
          aria-label="Gasto Inteligente"
          className="flex items-center justify-center active:scale-[0.98]"
        >
          <BrandMark variant="symbol" className="h-8 w-8" />
        </Link>

        {/* Direita — Avatar (44x44 clicável, ~36px visível) */}
        <Link
          to="/app/perfil"
          aria-label={t("aria.openProfile")}
          className="grid h-11 w-11 place-items-center rounded-full transition active:scale-95"
        >
          <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-border/60 bg-muted text-[11px] font-bold text-foreground">
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
        </Link>
      </div>
    </div>
  );
}
