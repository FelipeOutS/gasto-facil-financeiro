import { AdSenseSlot } from "@/components/AdSenseSlot";
import { AdsScriptProvider } from "@/components/AdsScriptProvider";
import { DirectAdSlot } from "@/components/DirectAdSlot";
import { PlaceholderAdSlot } from "@/components/PlaceholderAdSlot";
import { ADS_CONFIG, ADSENSE_SLOTS, DIRECT_ADS, canUseAdsense } from "@/lib/ads-config";
import { hasAdvertisingConsent } from "@/lib/ads-consent";

type AdSlotRendererProps = {
  className?: string;
  slotId: string;
};

export function AdSlotRenderer({ className, slotId }: AdSlotRendererProps) {
  if (!ADS_CONFIG.enableRealAds || ADS_CONFIG.provider === "placeholder") {
    return <PlaceholderAdSlot className={className} slotId={slotId} />;
  }

  if (ADS_CONFIG.provider === "direct") {
    const directAd = DIRECT_ADS[slotId];
    return directAd?.enabled ? (
      <DirectAdSlot ad={directAd} className={className} slotId={slotId} />
    ) : (
      <PlaceholderAdSlot className={className} slotId={slotId} />
    );
  }

  const allowed = canUseAdsense(ADS_CONFIG, hasAdvertisingConsent());
  const adUnitId = ADSENSE_SLOTS[slotId];
  if (!allowed || !adUnitId) {
    return <PlaceholderAdSlot className={className} slotId={slotId} />;
  }

  return (
    <>
      <AdsScriptProvider clientId={ADS_CONFIG.adsenseClient} enabled />
      <AdSenseSlot adUnitId={adUnitId} className={className} slotId={slotId} />
    </>
  );
}