import type { MouseEvent } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Home, Ellipsis } from "lucide-react";
import { useAlertaContas } from "@/lib/contas-alertas";
import { NAV_GROUPS, type NavLeaf } from "@/lib/nav-groups";
import { PRODUCT_EVENTS, trackProductEvent } from "@/lib/product-analytics";
import { useMobileKeyboard } from "@/lib/use-mobile-keyboard";
import { useLiquidNavIndicator } from "@/lib/use-liquid-nav-indicator";

// Reuse the destinations/labels/icons of the existing menu, not a second route map.
const menuItems = NAV_GROUPS.flatMap((group) => group.items);
function menuItem(to: string): NavLeaf {
  const item = menuItems.find((entry) => entry.to === to);
  if (!item) throw new Error(`Missing navigation item: ${to}`);
  return item;
}
export const MOBILE_TABS: readonly NavLeaf[] = [
  { to: "/app", labelKey: "dashboard", icon: Home },
  menuItem("/gastos"),
  menuItem("/renda"),
  menuItem("/cartoes"),
  { to: "/app/mais", labelKey: "more", icon: Ellipsis },
];

export function mobileTabIndex(pathname: string): number {
  const path = pathname.replace(/\/+$/, "") || "/";
  return MOBILE_TABS.findIndex(({ to }) =>
    to === "/app" ? path === to : path === to || path.startsWith(to + "/"),
  );
}

export function BottomNav() {
  const { t } = useTranslation("nav");
  const { pathname } = useLocation();
  const alerta = useAlertaContas();
  const keyboardOpen = useMobileKeyboard();
  const selected = mobileTabIndex(pathname);
  const indicator = useLiquidNavIndicator(selected);

  return (
    <nav
      className="mobile-bottom-nav lg:hidden"
      aria-label={t("aria.primary")}
      hidden={keyboardOpen}
    >
      <ul className="mobile-nav-track">
        <li
          ref={indicator}
          aria-hidden="true"
          className="mobile-nav-indicator"
          style={{
            transform: `translate3d(${Math.max(0, selected) * 100}%,0,0)`,
            opacity: selected < 0 ? 0 : 1,
          }}
        >
          <span />
        </li>
        {MOBILE_TABS.map(({ to, labelKey, icon: Icon }, index) => {
          const active = index === selected;
          const showDot = to === "/app" && alerta !== "nenhum";
          return (
            <li key={to} className="mobile-nav-item">
              <Link
                to={to}
                preload="intent"
                activeOptions={{ exact: to === "/app" }}
                aria-label={t(`items.${labelKey}`)}
                title={t(`items.${labelKey}`)}
                aria-current={active ? "page" : undefined}
                className="mobile-nav-link"
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  // Only the router navigates. Feedback never changes routing or blocks a retry.
                  trackProductEvent({
                    event: PRODUCT_EVENTS.navClick,
                    route: pathname,
                    source: "bottom_nav",
                    target: to,
                  });
                }}
              >
                <span className="mobile-nav-icon">
                  <Icon aria-hidden="true" size={22} strokeWidth={active ? 2.3 : 1.8} />
                  {showDot && (
                    <span
                      aria-hidden="true"
                      className={`mobile-nav-dot ${alerta === "vermelho" ? "bg-destructive" : "bg-warning"}`}
                    />
                  )}
                </span>
                {showDot && (
                  <span className="sr-only">
                    {t(alerta === "vermelho" ? "aria.overdueAccounts" : "aria.soonAccounts")}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
