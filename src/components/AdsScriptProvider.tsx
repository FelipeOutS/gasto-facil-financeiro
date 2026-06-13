import { useEffect } from "react";

const SCRIPT_ID = "google-adsense-script";

type AdsScriptProviderProps = {
  clientId: string;
  enabled: boolean;
};

export function AdsScriptProvider({ clientId, enabled }: AdsScriptProviderProps) {
  useEffect(() => {
    if (!enabled || !clientId || typeof document === "undefined") return;
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
    document.head.appendChild(script);
  }, [clientId, enabled]);

  return null;
}