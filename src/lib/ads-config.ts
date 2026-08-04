export type AdsProvider = "placeholder" | "direct" | "adsense";

export type AdsEnvironment = {
  enableRealAds?: string;
  provider?: string;
  adsenseClient?: string;
  adsenseTestMode?: string;
  requireConsent?: string;
};

export type AdsRuntimeConfig = {
  enableRealAds: boolean;
  provider: AdsProvider;
  adsenseClient: string;
  adsenseTestMode: boolean;
  requireConsent: boolean;
};

export type DirectAdConfig =
  | { enabled: boolean; kind: "internal"; to: "/meu-plano"; hash?: string }
  | { enabled: boolean; kind: "external"; href: string };

const VALID_PROVIDERS: readonly AdsProvider[] = ["placeholder", "direct", "adsense"];

export const DIRECT_ADS: Readonly<Record<string, DirectAdConfig>> = {
  "dashboard-middle": {
    enabled: true,
    kind: "internal",
    to: "/meu-plano",
    hash: "planos-disponiveis",
  },
};

// Intencionalmente vazio até existirem aprovação, client ID e IDs de slot reais.
export const ADSENSE_SLOTS: Readonly<Record<string, string>> = {};

export function getEnabledDirectAd(slotId: string): DirectAdConfig | null {
  const directAd = DIRECT_ADS[slotId];
  return directAd?.enabled ? directAd : null;
}

export function resolveAdsConfig(env: AdsEnvironment): AdsRuntimeConfig {
  const provider = VALID_PROVIDERS.includes(env.provider as AdsProvider)
    ? (env.provider as AdsProvider)
    : "placeholder";

  return {
    enableRealAds: env.enableRealAds === "true",
    provider,
    adsenseClient: env.adsenseClient?.trim() ?? "",
    adsenseTestMode: env.adsenseTestMode !== "false",
    requireConsent: env.requireConsent !== "false",
  };
}

export const ADS_CONFIG = resolveAdsConfig({
  enableRealAds: import.meta.env.VITE_ENABLE_REAL_ADS,
  provider: import.meta.env.VITE_ADS_PROVIDER,
  adsenseClient: import.meta.env.VITE_GOOGLE_ADSENSE_CLIENT,
  adsenseTestMode: import.meta.env.VITE_ADSENSE_TEST_MODE,
  requireConsent: import.meta.env.VITE_ADS_REQUIRE_CONSENT,
});

export function canUseAdsense(config: AdsRuntimeConfig, hasConsent: boolean): boolean {
  if (!config.enableRealAds || config.provider !== "adsense" || !config.adsenseClient) return false;
  if (config.requireConsent && !hasConsent) return false;
  return true;
}
