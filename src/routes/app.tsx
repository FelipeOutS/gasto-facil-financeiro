import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import { BrandLoader } from "@/components/BrandLoader";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { LANG_STORAGE_KEY, isLocale } from "@/i18n";

const APP_BOOT_TIMEOUT_MS = 8000;

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Gasto Inteligente" },
      { name: "robots", content: "noindex,nofollow" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ],
  }),
  component: AppEntry,
});

function AppEntry() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("dashboard");
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    try {
      const saved =
        typeof window !== "undefined"
          ? window.localStorage.getItem(LANG_STORAGE_KEY)
          : null;
      const lang = isLocale(saved) ? saved : "pt";
      if (i18n.language !== lang) {
        void i18n.changeLanguage(lang);
      }
    } catch {
      void i18n.changeLanguage("pt");
    }
  }, [i18n]);

  useEffect(() => {
    if (loading) return;
    if (user) {
      void navigate({ to: "/", replace: true });
    } else {
      void navigate({ to: "/login", replace: true });
    }
  }, [loading, user, navigate]);

  // Timeout de segurança: se o boot demorar mais que 8s, mostra fallback.
  useEffect(() => {
    if (!loading) return;
    const t = window.setTimeout(() => setTimedOut(true), APP_BOOT_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [loading]);

  if (timedOut && loading) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center bg-background px-6"
        style={{
          minHeight: "100dvh",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="flex max-w-sm flex-col items-center gap-5 text-center">
          <BrandMark className="h-12 w-auto sm:h-14" />
          <div className="space-y-2">
            <h1 className="text-lg font-semibold">Não conseguimos abrir o app</h1>
            <p className="text-sm text-muted-foreground">
              Verifique sua conexão e tente novamente.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2">
            <Button
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              className="w-full"
            >
              Tentar novamente
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">Ir para login</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <BrandLoader message="Só um instante..." />;
}
