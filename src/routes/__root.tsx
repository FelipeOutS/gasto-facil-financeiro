import {
  Outlet,
  Link,
  createRootRoute,
  HeadContent,
  Scripts,
  retainSearchParams,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth-context";
import { AppLockProvider } from "@/lib/app-lock";
import { ThemeProvider } from "@/lib/theme";
import { AccentProvider } from "@/lib/accent";
import { SubscriptionGuardProvider } from "@/lib/subscription-guard";
import { ActiveAccountProvider } from "@/lib/active-account";
import { ConnectedAccountBanner } from "@/components/ConnectedAccountBanner";
import { OfflineSyncStatus } from "@/components/offline/OfflineSyncStatus";
import { OfflineIncomeSyncStatus } from "@/components/offline/OfflineIncomeSyncStatus";
import { useAuth } from "@/lib/auth-context";
import { useMercadoSync } from "@/lib/mercado/mercado-sync";
import { useOfflineExpenseQueue } from "@/lib/offline/use-offline-sync";
import { useOfflineIncomeQueue } from "@/lib/offline/use-offline-income-sync";
import { preloadAllBankLogos, preloadAllMerchantLogos } from "@/lib/logos";
import "@/i18n";
import { useLocale } from "@/i18n/use-locale";

import appCss from "../styles.css?url";

const rootSearchSchema = z.object({
  lang: fallback(z.enum(["pt", "en"]).optional(), undefined).optional(),
});

// Cores aproximadas de --background light/dark (oklch convertido p/ hex)
// usadas pelo navegador/WebView para pintar a status bar e a área de
// overscroll de forma integrada ao app.
const THEME_COLOR_DARK = "#1E2126";
const THEME_COLOR_LIGHT = "#FAFAFB";
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('gf-theme')||'dark';var r=t;if(t==='system'){r=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var d=document.documentElement;if(r==='light'){d.classList.add('light');d.classList.remove('dark');d.style.colorScheme='light';}else{d.classList.add('dark');d.classList.remove('light');d.style.colorScheme='dark';}var c=r==='light'?'${THEME_COLOR_LIGHT}':'${THEME_COLOR_DARK}';var m=document.querySelector('meta[name=\"theme-color\"]:not([media])');if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m);}m.setAttribute('content',c);}catch(e){}})();`;

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
  validateSearch: zodValidator(rootSearchSchema),
  search: { middlewares: [retainSearchParams(["lang"])] },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Gasto Inteligente — Controle de gastos do mês" },
      {
        name: "description",
        content:
          "Cadastre seus gastos por foto, print ou manualmente. Veja gráficos por categoria e controle seus limites.",
      },
      // Status bar / overscroll: cor por preferência do SO; o ThemeProvider
      // também sobrescreve em runtime quando o usuário força light/dark.
      { name: "theme-color", media: "(prefers-color-scheme: light)", content: THEME_COLOR_LIGHT },
      { name: "theme-color", media: "(prefers-color-scheme: dark)", content: THEME_COLOR_DARK },
      { property: "og:site_name", content: "Gasto Inteligente" },
      { property: "og:title", content: "Gasto Inteligente — Controle de gastos do mês" },
      {
        property: "og:description",
        content:
          "Organize gastos, contas, cartões, clientes, fornecedores e relatórios em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/cbdbf992-e65f-4ef8-8f0f-d0847404378f/id-preview-8d7db3be--5de62d63-2340-4175-8a16-26c2beff1e71.lovable.app-1779115302264.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Gasto Inteligente — controle financeiro simples, visual e inteligente" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Gasto Inteligente — Controle de gastos do mês" },
      { name: "twitter:description", content: "Gasto Inteligente é uma plataforma de controle financeiro que organiza suas receitas, despesas, contas e metas de forma simples e visual. Acompanhe seu saldo, f" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/cbdbf992-e65f-4ef8-8f0f-d0847404378f/id-preview-8d7db3be--5de62d63-2340-4175-8a16-26c2beff1e71.lovable.app-1779115302264.png" },
      { name: "description", content: "Gasto Inteligente é uma plataforma de controle financeiro que organiza suas receitas, despesas, contas e metas de forma simples e visual. Acompanhe seu saldo, f" },
      { property: "og:description", content: "Gasto Inteligente é uma plataforma de controle financeiro que organiza suas receitas, despesas, contas e metas de forma simples e visual. Acompanhe seu saldo, f" },
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
        fetchPriority: "high",
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
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <AccentProvider>
            <AuthProvider>
              <AppLockProvider>
                <ActiveAccountProvider>
                  <SubscriptionGuardProvider>{children}</SubscriptionGuardProvider>
                </ActiveAccountProvider>
              </AppLockProvider>
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

  // Sincroniza Mercado Inteligente (listas) com Supabase por usuário.
  useMercadoSync();

  // Sincroniza idioma (URL ↔ i18n ↔ localStorage ↔ <html lang>)
  useLocale();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Hreflang dinâmico: aponta para /pt{path} e /en{path} para SEO multilíngue.
  // Usa o pathname "limpo" (sem prefixo /pt|/en).
  const cleanPath = pathname.replace(/^\/(pt|en)(?=\/|$)/, "") || "/";

  return (
    <>
      <HreflangTags path={cleanPath} />
      <ConnectedAccountBanner />
      <OfflineQueueMount />
      <Outlet />
      <Toaster position="top-center" />
    </>
  );
}

/**
 * Mantém a fila offline de gastos viva no app inteiro: ao logar, dispara
 * a sincronização (caso já esteja online) e escuta o evento `online`.
 * O badge só aparece quando há pendências.
 */
function OfflineQueueMount() {
  const { user } = useAuth();
  useOfflineExpenseQueue(user?.id ?? null);
  useOfflineIncomeQueue(user?.id ?? null);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-40 mx-auto flex max-w-md flex-col items-center gap-2 px-3">
      <div className="pointer-events-auto w-full">
        <OfflineSyncStatus />
      </div>
      <div className="pointer-events-auto w-full">
        <OfflineIncomeSyncStatus />
      </div>
    </div>
  );
}

function HreflangTags({ path }: { path: string }) {
  // Usar useEffect + manipulação direta do <head> garante que tags antigas sejam
  // removidas em transições de rota (evita acúmulo entre navegações no SPA).
  useEffect(() => {
    const base = "https://gastointeligente.com.br";
    const ptHref = `${base}/pt${path === "/" ? "" : path}`;
    const enHref = `${base}/en${path === "/" ? "" : path}`;
    const tags = [
      { hreflang: "pt-BR", href: ptHref },
      { hreflang: "en", href: enHref },
      { hreflang: "x-default", href: ptHref },
    ];
    const created: HTMLLinkElement[] = [];
    for (const t of tags) {
      const link = document.createElement("link");
      link.rel = "alternate";
      link.hreflang = t.hreflang;
      link.href = t.href;
      link.dataset.hreflang = "1";
      document.head.appendChild(link);
      created.push(link);
    }
    return () => {
      created.forEach((el) => el.remove());
    };
  }, [path]);
  return null;
}
