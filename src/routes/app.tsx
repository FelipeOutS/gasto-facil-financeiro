import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import { BrandLoader } from "@/components/BrandLoader";

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
  const { i18n } = useTranslation();

  // Garante idioma: usa o salvo (i18next detecta localStorage) ou PT-BR como padrão.
  useEffect(() => {
    try {
      const saved =
        typeof window !== "undefined"
          ? window.localStorage.getItem("i18nextLng")
          : null;
      const lang = saved && saved.trim() ? saved : "pt-BR";
      if (i18n.language !== lang) {
        void i18n.changeLanguage(lang);
      }
    } catch {
      void i18n.changeLanguage("pt-BR");
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <BrandLoader />
    </div>
  );
}
