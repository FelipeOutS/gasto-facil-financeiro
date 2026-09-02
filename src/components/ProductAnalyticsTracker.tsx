import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  PRODUCT_EVENTS,
  registerProductAnalyticsSender,
  trackProductEvent,
} from "@/lib/product-analytics";

/**
 * Fase 2 — instrumentação de navegação.
 *
 * Dispara `page_view` (rota normalizada + rota anterior) a cada navegação.
 * Não altera layout algum: não renderiza nada.
 */
export function ProductAnalyticsTracker() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const prev = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/product-analytics.functions").then(({ ingestProductEvents }) => {
      if (cancelled) return;
      registerProductAnalyticsSender(async (events) => {
        await ingestProductEvents({ data: { events } });
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    trackProductEvent({
      event: PRODUCT_EVENTS.pageView,
      route: pathname,
      prevRoute: prev.current ?? undefined,
      source: prev.current ? undefined : "deep_link",
    });
    prev.current = pathname;
  }, [pathname]);

  return null;
}
