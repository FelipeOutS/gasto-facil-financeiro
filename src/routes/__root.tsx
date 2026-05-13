import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme";
import { AccentProvider } from "@/lib/accent";
import { SubscriptionGuardProvider } from "@/lib/subscription-guard";
import { ActiveAccountProvider } from "@/lib/active-account";
import { ConnectedAccountBanner } from "@/components/ConnectedAccountBanner";
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
      { name: "theme-color", content: "#0B1F3A" },
      { property: "og:site_name", content: "Gasto Inteligente" },
      { property: "og:title", content: "Gasto Inteligente — Controle financeiro simples e visual" },
      {
        property: "og:description",
        content:
          "Organize gastos, contas, cartões, clientes, fornecedores e relatórios em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://gastointeligente.com.br/og-gasto-inteligente.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Gasto Inteligente — controle financeiro simples, visual e inteligente" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Gasto Inteligente" },
      { name: "twitter:description", content: "Organize gastos, contas, cartões, clientes, fornecedores e relatórios em um só lugar." },
      { name: "twitter:image", content: "https://gastointeligente.com.br/og-gasto-inteligente.png" },
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
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      {
        rel: "preload",
        as: "image",
        href: "/logos/brand/gasto-inteligente-light.png",
        fetchpriority: "high",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Gasto Inteligente",
          url: "https://gastointeligente.com.br",
          logo: "https://gastointeligente.com.br/logos/brand/gasto-inteligente-light.png",
          email: "contato@gastointeligente.com.br",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Gasto Inteligente",
          url: "https://gastointeligente.com.br",
          description:
            "Organize gastos, contas, cartões, clientes, fornecedores e relatórios em um só lugar.",
          inLanguage: "pt-BR",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Gasto Inteligente",
          applicationCategory: "FinanceApplication",
          operatingSystem: "Web",
          url: "https://gastointeligente.com.br",
        }),
      },
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
              <ActiveAccountProvider>
                <SubscriptionGuardProvider>{children}</SubscriptionGuardProvider>
              </ActiveAccountProvider>
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
      <ConnectedAccountBanner />
      <Outlet />
      <Toaster position="top-center" />
    </>
  );
}
