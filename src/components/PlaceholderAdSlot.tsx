import { Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type PlaceholderAdSlotProps = {
  className?: string;
  slotId: string;
};

export function PlaceholderAdSlot({ className, slotId }: PlaceholderAdSlotProps) {
  const { t } = useTranslation("common");

  return (
    <aside
      role="complementary"
      aria-label={t("ads.placeholderTitle")}
      data-ad-slot={slotId}
      data-ad-provider="placeholder"
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-3 text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Megaphone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">{t("ads.sponsoredLabel")}</p>
        <p className="truncate text-sm font-medium text-foreground/80">{t("ads.placeholderTitle")}</p>
        <p className="truncate text-xs text-muted-foreground">{t("ads.placeholderSubtitle")}</p>
      </div>
    </aside>
  );
}