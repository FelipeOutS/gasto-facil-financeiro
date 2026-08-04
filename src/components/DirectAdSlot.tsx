import { Link } from "@tanstack/react-router";
import { ArrowRight, ExternalLink, Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { DirectAdConfig } from "@/lib/ads-config";

type DirectAdSlotProps = {
  ad: DirectAdConfig;
  className?: string;
  slotId: string;
};

export function DirectAdSlot({ ad, className, slotId }: DirectAdSlotProps) {
  const { t } = useTranslation("common");

  return (
    <aside
      role="complementary"
      aria-label={t("ads.sponsoredLabel")}
      data-ad-slot={slotId}
      data-ad-provider="direct"
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Megaphone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("ads.sponsoredLabel")}
        </p>
        <p className="text-sm font-medium text-foreground">{t("ads.partnerSpaceTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("ads.partnerSpaceDescription")}</p>
      </div>
      {ad.kind === "internal" ? (
        <Link
          to={ad.to}
          hash={ad.hash}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("ads.learnMore")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : (
        <a
          href={ad.href}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("ads.learnMore")}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}
    </aside>
  );
}
