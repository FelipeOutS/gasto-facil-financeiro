import { Link, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { usePlan } from "@/lib/use-plan";
import { NAV_GROUPS, filterVisibleGroups } from "@/lib/nav-groups";
import { DESKTOP_AREAS, desktopAreaDestination, desktopAreaForPath } from "@/lib/desktop-areas";
import { BrandMark } from "./BrandMark";
import { ThemeToggle } from "./ThemeToggle";
import { UserAvatar } from "./UserAvatar";

export function DesktopTopBar() {
  const { pathname } = useLocation();
  const { profile, user } = useAuth();
  const { can, isAdminMaster } = usePlan();
  const groups = filterVisibleGroups(
    NAV_GROUPS.filter((g) => !g.adminMasterOnly || isAdminMaster),
    can,
    isAdminMaster,
    profile?.tipo_cadastro,
  );
  const active = desktopAreaForPath(pathname);
  return (
    <header className="premium-topbar hidden lg:flex">
      <Link to="/app" className="finexy-brand" aria-label="Gasto Inteligente, início">
        <BrandMark variant="sidebar" className="h-10 w-auto" />
      </Link>
      <nav aria-label="Áreas do aplicativo" className="premium-tabs">
        {DESKTOP_AREAS.map((area) => {
          const to = desktopAreaDestination(area, groups);
          return to ? (
            <Link key={area.id} to={to} aria-current={active.id === area.id ? "page" : undefined}>
              {area.label}
            </Link>
          ) : null;
        })}
      </nav>
      <div className="flex shrink-0 items-center gap-3">
        <ThemeToggle />
        <Link to="/conta" className="premium-profile" aria-label="Meu perfil">
          <UserAvatar
            url={profile?.avatar_url}
            name={profile?.nome}
            email={user?.email}
            size={36}
          />
          <span className="hidden xl:block max-w-32 truncate text-sm font-semibold">
            {profile?.nome?.split(" ")[0] || "Minha conta"}
          </span>
        </Link>
      </div>
    </header>
  );
}
