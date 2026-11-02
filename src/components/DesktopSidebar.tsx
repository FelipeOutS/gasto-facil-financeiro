import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, Lock } from "lucide-react";
import { usePlan } from "@/lib/use-plan";
import { useAuth } from "@/lib/auth-context";
import { NAV_GROUPS, filterVisibleGroups } from "@/lib/nav-groups";
import { PREMIUM_ROUTE_RULES } from "@/lib/premium-routes";
import { PremiumLockModal } from "./PremiumLockModal";
import { ConnectedAccountSwitcher } from "./ConnectedAccountSwitcher";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";

export function DesktopSidebar() {
  const { t } = useTranslation("nav");
  const { pathname } = useLocation();
  const { can, isAdminMaster } = usePlan();
  const { profile } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const [lock, setLock] = useState({ open: false, title: "" });
  const groups = filterVisibleGroups(
    NAV_GROUPS.filter((g) => !g.adminMasterOnly || isAdminMaster),
    can,
    isAdminMaster,
    profile?.tipo_cadastro,
  );
  return (
    <aside className="premium-sidebar finexy-rail hidden lg:flex" aria-label={t("aria.side")}>
      <nav aria-label="Módulos do aplicativo" className="finexy-rail-nav">
        <Link
          activeOptions={{ exact: true }}
          to="/app"
          aria-label="Visão geral"
          title="Visão geral"
          aria-current={pathname === "/app" ? "page" : undefined}
          className="finexy-rail-button"
        >
          <LayoutGrid size={20} />
        </Link>
        {groups.map((group) => {
          const Icon = group.items[0].icon;
          const active = group.items.some(
            (item) => pathname === item.to || pathname.startsWith(item.to + "/"),
          );
          return (
            <Popover
              key={group.id}
              open={open === group.id}
              onOpenChange={(value) => setOpen(value ? group.id : null)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="finexy-rail-button"
                  aria-label={t(group.labelKey)}
                  title={t(group.labelKey)}
                  data-active={active || undefined}
                >
                  <Icon size={20} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" sideOffset={16} className="finexy-flyout">
                <h2 className="mb-3 text-sm font-semibold">{t(group.labelKey)}</h2>
                {group.items.map((item) => {
                  const rule = PREMIUM_ROUTE_RULES.find((r) => r.path === item.to);
                  const locked = !isAdminMaster && rule && !can(rule.feature);
                  const ItemIcon = item.icon;
                  const content = (
                    <>
                      <ItemIcon size={18} />
                      <span>{t(`items.${item.labelKey}`)}</span>
                      {locked && <Lock size={14} />}
                    </>
                  );
                  return locked ? (
                    <button
                      key={item.to}
                      className="finexy-flyout-link"
                      onClick={() => {
                        setOpen(null);
                        setLock({ open: true, title: rule.title });
                      }}
                    >
                      {content}
                    </button>
                  ) : (
                    <Link
                      key={item.to}
                      className="finexy-flyout-link"
                      to={item.to}
                      aria-current={pathname === item.to ? "page" : undefined}
                      onClick={() => setOpen(null)}
                    >
                      {content}
                    </Link>
                  );
                })}
                {group.id === "conta" && <ConnectedAccountSwitcher />}
              </PopoverContent>
            </Popover>
          );
        })}
      </nav>
      <PremiumLockModal
        open={lock.open}
        title={lock.title}
        onOpenChange={(value) => setLock((previous) => ({ ...previous, open: value }))}
      />
    </aside>
  );
}
