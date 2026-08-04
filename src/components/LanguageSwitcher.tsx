import { Globe, Check } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useLocale } from "@/i18n/use-locale";
import { SUPPORTED_LOCALES, type Locale } from "@/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const SHORT_LABEL: Record<Locale, string> = { pt: "PT", en: "EN" };

type Variant = "ghost-light" | "ghost-dark";

export function LanguageSwitcher({
  variant = "ghost-dark",
  align = "end",
  className,
}: {
  variant?: Variant;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();

  const triggerClasses =
    variant === "ghost-light"
      ? "inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
      : "inline-flex h-10 items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

  return (
    <>
      <Link
        to="/app/idioma"
        aria-label={t("lang.select")}
        className={cn(triggerClasses, "lg:hidden", className)}
      >
        <Globe className="h-4 w-4" aria-hidden="true" />
        <span>{SHORT_LABEL[locale]}</span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("lang.select")}
          className={cn(triggerClasses, "hidden lg:inline-flex", className)}
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
          <span>{SHORT_LABEL[locale]}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="min-w-[180px]">
          {SUPPORTED_LOCALES.map((code) => (
            <DropdownMenuItem
              key={code}
              onSelect={() => setLocale(code)}
              className="cursor-pointer"
            >
              <span className="flex flex-1 items-center gap-2">
                <span className="inline-flex h-5 w-7 items-center justify-center rounded bg-muted text-[10px] font-bold uppercase tracking-wider">
                  {SHORT_LABEL[code]}
                </span>
                {t(`lang.${code}`)}
              </span>
              {locale === code && (
                <Check className="ml-2 h-4 w-4 text-primary" aria-hidden="true" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
