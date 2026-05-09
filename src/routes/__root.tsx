import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme";
import { AccentProvider } from "@/lib/accent";
import { SubscriptionGuardProvider } from "@/lib/subscription-guard";
import { ActiveAccountProvider } from "@/lib/active-account";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { preloadAllBankLogos, preloadAllMerchantLogos } from "@/lib/logos";

import appCss from "../styles.css?url";

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('gf-theme')||'dark';var r=t;if(t==='system'){r=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var d=document.documentElement;if(r==='light'){d.classList.add('light');d.classList.remove('dark');d.style.colorScheme='light';}else{d.classList.add('dark');d.classList.remove('light');d.style.colorScheme='dark';}}catch(e){}})();`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Gasto Inteligente — Controle de gastos do mês" },
      {
        name: "description",
        content:
          "Cadastre seus gastos por foto, print ou manualmente. Veja gráficos por categoria e controle seus limites.",
      },
      { name: "theme-color", content: "#181818" },
      { property: "og:title", content: "Gasto Inteligente — Controle de gastos do mês" },
      {
        property: "og:description",
        content: "Controle simples e visual dos seus gastos do mês.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Gasto Inteligente — Controle de gastos do mês" },
      { name: "description", content: "Controle gastos, renda, dinheiro guardado e metas financeiras em um app simples, visual e organizado para sua vida financeira." },
      { property: "og:description", content: "Controle gastos, renda, dinheiro guardado e metas financeiras em um app simples, visual e organizado para sua vida financeira." },
      { name: "twitter:description", content: "Controle gastos, renda, dinheiro guardado e metas financeiras em um app simples, visual e organizado para sua vida financeira." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/7d6618a1-4258-4191-814f-3125b565131f/id-preview-390ec87b--5de62d63-2340-4175-8a16-26c2beff1e71.lovable.app-1777051823289.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/7d6618a1-4258-4191-814f-3125b565131f/id-preview-390ec87b--5de62d63-2340-4175-8a16-26c2beff1e71.lovable.app-1777051823289.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap",
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/favicon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <AccentProvider>
            <AuthProvider>
              <SubscriptionGuardProvider>{children}</SubscriptionGuardProvider>
            </AuthProvider>
          </AccentProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  // Preload bank + merchant logos once so transaction lists and card swaps
  // render instantly — no white flash, no late-arriving images.
  useEffect(() => {
    preloadAllBankLogos();
    preloadAllMerchantLogos();
  }, []);

  return (
    <>
      <Outlet />
      <Toaster position="top-center" />
    </>
  );
}
