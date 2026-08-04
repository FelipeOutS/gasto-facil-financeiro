import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MobileShell } from "@/components/MobileShell";
import { BrandMark } from "@/components/BrandMark";
import { LANG_STORAGE_KEY, SUPPORTED_LOCALES, type Locale } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app_/idioma")({
  head: () => ({ meta: [{ title: "Idioma do app — Gasto Inteligente" }] }),
  component: AppIdiomaPage,
});

function AppIdiomaPage() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const locale: Locale = (i18n.resolvedLanguage || i18n.language || "pt")
    .toLowerCase()
    .startsWith("en")
    ? "en"
    : "pt";

  function choose(next: Locale) {
    if (next === locale) return;
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    void i18n.changeLanguage(next);
    if (typeof document !== "undefined") {
      document.documentElement.lang = next === "en" ? "en" : "pt-BR";
    }
  }

  const content = (
    <>
      <header className="flex items-start gap-3 pt-2">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground active:scale-95"
          aria-label={t("actions.back")}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t("lang.appTitle")}</h1>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            {t("lang.appDescription")}
          </p>
        </div>
      </header>

      <section className="mt-5 space-y-3">
        {SUPPORTED_LOCALES.map((code) => {
          const active = locale === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => choose(code)}
              className={cn(
                "flex w-full items-center gap-3 rounded-3xl border bg-card p-4 text-left shadow-card active:scale-[0.99]",
                active ? "border-primary/60 ring-1 ring-primary/30" : "border-border",
              )}
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-card-elevated">
                <Languages className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{t(`lang.${code}`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {active ? t("lang.current", { name: t(`lang.${code}`) }) : t("lang.tapToApply")}
                </span>
              </span>
              {active && <Check className="h-5 w-5 text-primary" />}
            </button>
          );
        })}
      </section>
    </>
  );

  if (session) return <MobileShell unprotected>{content}</MobileShell>;

  return (
    <div className="min-h-screen min-h-dvh bg-background px-4 py-6 text-foreground safe-top">
      <div className="mx-auto flex max-w-md flex-col">
        <Link to="/app" className="mb-6 inline-flex w-fit" aria-label="Gasto Inteligente">
          <BrandMark className="h-10 w-auto" />
        </Link>
        {content}
      </div>
    </div>
  );
}
