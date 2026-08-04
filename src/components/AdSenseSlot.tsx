import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ADS_CONFIG } from "@/lib/ads-config";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    adsbygoogle?: Record<string, unknown>[];
  }
}

type AdSenseSlotProps = {
  className?: string;
  slotId: string;
  adUnitId: string;
};

export function AdSenseSlot({ className, slotId, adUnitId }: AdSenseSlotProps) {
  const { t } = useTranslation("common");
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current || !adUnitId || typeof window === "undefined") return;
    requested.current = true;
    window.adsbygoogle = window.adsbygoogle ?? [];
    window.adsbygoogle.push({});
  }, [adUnitId]);

  return (
    <aside
      role="complementary"
      aria-label={t("ads.sponsoredLabel")}
      data-ad-slot={slotId}
      data-ad-provider="adsense"
      className={cn("rounded-2xl border border-border bg-muted/30 px-4 py-3", className)}
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("ads.sponsoredLabel")}
      </p>
      <ins
        className="adsbygoogle block"
        data-ad-client={ADS_CONFIG.adsenseClient}
        data-ad-slot={adUnitId}
        data-ad-format="auto"
        data-full-width-responsive="true"
        data-adtest={ADS_CONFIG.adsenseTestMode ? "on" : undefined}
      />
    </aside>
  );
}
