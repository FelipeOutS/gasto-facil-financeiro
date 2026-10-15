import type { MouseEvent } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Home, Plus } from "lucide-react";
import { Fragment } from "react";
import { MobileQuickActionsSheet } from "@/components/MobileQuickActionsSheet";
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
  menuItem("/cartoes"),
  menuItem("/app/cofre-pessoal"),
];

export function mobileTabIndex(pathname: string): number {
  const path = pathname.replace(/\/+$/, "") || "/";
  const tab = MOBILE_TABS.findIndex(({ to }) =>
    to === "/app" ? path === to : path === to || path.startsWith(to + "/"),
  );
  // The middle slot is an action, never a selected destination.
  if (tab !== -1) return tab < 2 ? tab : tab + 1;
  // Secondary screens belong to the top menu, not to the vault.
  return -1;
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
      <svg className="mobile-nav-surface" viewBox="0 0 420 64" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path
          d="M26 .5 H158 C172 .5 169 10 178 29 C187 58 233 58 242 29 C251 10 248 .5 262 .5 H394 Q419.5 .5 419.5 26 V38 Q419.5 63.5 394 63.5 H26 Q.5 63.5 .5 38 V26 Q.5 .5 26 .5 Z"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
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
          const slot = index < 2 ? index : index + 1;
          const active = slot === selected;
          const showDot = to === "/app" && alerta !== "nenhum";
          return (
            <Fragment key={to}>
            {index === 2 && (
              <li className="mobile-nav-item mobile-nav-create-item">
                <MobileQuickActionsSheet
                  financialOnly
                  trigger={
                    <button type="button" className="mobile-nav-create" aria-label={t("mobile.create")}>
                      <Plus size={24} strokeWidth={1.7} aria-hidden="true" />
                    </button>
                  }
                />
              </li>
            )}
            <li className="mobile-nav-item">
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
                  <Icon aria-hidden="true" size={20} strokeWidth={active ? 2.2 : 1.7} fill={active && to === "/app" ? "currentColor" : "none"} />
                  {showDot && (
                    <span
                      aria-hidden="true"
                      className={`mobile-nav-dot ${alerta === "vermelho" ? "bg-destructive" : "bg-warning"}`}
                    />
                  )}
                </span>
                <span className="mobile-nav-label">{t(to === "/app" ? "mobile.home" : to === "/app/cofre-pessoal" ? "mobile.vault" : `items.${labelKey}`)}</span>
                {showDot && (
                  <span className="sr-only">
                    {t(alerta === "vermelho" ? "aria.overdueAccounts" : "aria.soonAccounts")}
                  </span>
                )}
              </Link>
            </li>
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}
