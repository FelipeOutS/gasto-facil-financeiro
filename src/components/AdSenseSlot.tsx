import { useEffect, useRef } from "react";
import { ADS_CONFIG } from "@/lib/ads-config";

declare global {
  interface Window {
    adsbygoogle?: Record<string, unknown>[];
  }
}

type AdSenseSlotProps = {
  slotId: string;
  adUnitId: string;
};

export function AdSenseSlot({ slotId, adUnitId }: AdSenseSlotProps) {
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current || !adUnitId || typeof window === "undefined") return;
    requested.current = true;
    window.adsbygoogle = window.adsbygoogle ?? [];
    window.adsbygoogle.push({});
  }, [adUnitId]);

  return (
    <aside role="complementary" data-ad-slot={slotId} data-ad-provider="adsense">
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