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
import { ConfirmDialogHost } from "@/components/ConfirmDialog";
import { AuthProvider } from "@/lib/auth-context";
import { AppLockProvider } from "@/lib/app-lock";
import { ThemeProvider } from "@/lib/theme";
import { AccentProvider } from "@/lib/accent";
import { CookieConsentProvider } from "@/lib/cookie-consent";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { SubscriptionGuardProvider } from "@/lib/subscription-guard";
import { ActiveAccountProvider } from "@/lib/active-account";
import { ConnectedAccountBanner } from "@/components/ConnectedAccountBanner";
import { OfflineSyncStatus } from "@/components/offline/OfflineSyncStatus";
import { OfflineIncomeSyncStatus } from "@/components/offline/OfflineIncomeSyncStatus";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth-context";
import { useMercadoSync } from "@/lib/mercado/mercado-sync";
import { useOfflineExpenseQueue } from "@/lib/offline/use-offline-sync";
import { useOfflineIncomeQueue } from "@/lib/offline/use-offline-income-sync";
import { preloadAllBankLogos, preloadAllMerchantLogos } from "@/lib/logos";
import "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { PWAUpdateToast } from "@/components/pwa/PWAUpdateToast";

import appCss from "../styles.css?url";

    if (typeof window !== "undefined" && "serviceWorker" in navigator && import.meta.env.PROD) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .then((registration) => {
            registration.onupdatefound = () => {
              const installingWorker = registration.installing;
              if (installingWorker) {
                installingWorker.onstatechange = () => {
                  if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
                    // Update available: notify user
                    window.dispatchEvent(new CustomEvent("pwa-update-available", { detail: registration }));
                  }
                };
              }
            };
          })
          .catch((err) => {
            console.error("SW registration failed:", err);
          });
      });
    }


const rootSearchSchema = z.object({
  lang: fallback(z.enum(["pt", "en"]).optional(), undefined).optional(),
});

// Cores aproximadas de --background light/dark (oklch convertido p/ hex)
// usadas pelo navegador/WebView para pintar a status bar e a área de
// overscroll de forma integrada ao app.
const THEME_COLOR_DARK = "#1E2126";
const THEME_COLOR_LIGHT = "#FAFAFB";
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('gf-theme')||'dark';var r=t;if(t==='system'){r=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var d=document.documentElement;if(r==='light'){d.classList.add('light');d.classList.remove('dark');d.style.colorScheme='light';}else{d.classList.add('dark');d.classList.remove('light');d.style.colorScheme='dark';}var c=r==='light'?'${THEME_COLOR_LIGHT}':'${THEME_COLOR_DARK}';var m=document.querySelector('meta[name=\"theme-color\"]:not([media])');if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m);}m.setAttribute('content',c);}catch(e){}})();`;

// Google Tag Manager (GTM-MCF5CMWP) — NÃO é injetado no HTML.
// O contêiner só é carregado em runtime, via CookieConsentProvider, depois de
// consentimento explícito para Analytics ou Marketing (Consent Mode v2 básico).

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
      { title: "Gasto Inteligente — Controle financeiro pessoal, MEI e empresas" },
      {
        name: "description",
        content:
          "Organize gastos, receitas, cartões, metas, mercado, relatórios e previsões financeiras em um só lugar.",
      },
      // Status bar / overscroll: cor por preferência do SO; o ThemeProvider
      // também sobrescreve em runtime quando o usuário força light/dark.
      { name: "theme-color", media: "(prefers-color-scheme: light)", content: THEME_COLOR_LIGHT },
      { name: "theme-color", media: "(prefers-color-scheme: dark)", content: THEME_COLOR_DARK },
      { property: "og:site_name", content: "Gasto Inteligente" },
      { property: "og:type", content: "website" },
      {
        property: "og:title",
        content: "Gasto Inteligente — Controle financeiro pessoal, MEI e empresas",
      },
      {
        property: "og:description",
        content:
          "Organize gastos, receitas, cartões, metas, mercado, relatórios e previsões financeiras em um só lugar.",
      },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:title",
        content: "Gasto Inteligente — Controle financeiro pessoal, MEI e empresas",
      },
      {
        name: "twitter:description",
        content:
          "Organize gastos, receitas, cartões, metas, mercado, relatórios e previsões financeiras em um só lugar.",
      },
      {
        name: "description",
        content:
          "Gasto Inteligente: controle financeiro pessoal com registro manual, foto e importação de investimentos.",
      },
      {
        property: "og:description",
        content:
          "Gasto Inteligente: controle financeiro pessoal com registro manual, foto e importação de investimentos.",
      },
      {
        name: "twitter:description",
        content:
          "Gasto Inteligente: controle financeiro pessoal com registro manual, foto e importação de investimentos.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/727ea37a-7137-4b26-8a7e-78b184885840/id-preview-3104884e--5de62d63-2340-4175-8a16-26c2beff1e71.lovable.app-1782072328943.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/727ea37a-7137-4b26-8a7e-78b184885840/id-preview-3104884e--5de62d63-2340-4175-8a16-26c2beff1e71.lovable.app-1782072328943.png",
      },
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
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/logos/brand/favicon-light-32.svg",
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/logos/brand/favicon-dark-32.svg",
        media: "(prefers-color-scheme: dark)",
      },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest", crossorigin: "use-credentials" },
      {
        rel: "preload",
        as: "image",
        href: "/logos/brand/logo-gasto-inteligente-completo-light.svg",
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
          logo: "https://gastointeligente.com.br/logos/brand/logo-gasto-inteligente-completo-light.svg",
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
        {/* Sem iframe noscript do GTM: o contêiner não pode carregar antes do consentimento. */}
        <ThemeProvider>
          <AccentProvider>
            <CookieConsentProvider>
              <AuthProvider>
                <AppLockProvider>
                  <ActiveAccountProvider>
                    <SubscriptionGuardProvider>{children}</SubscriptionGuardProvider>
                  </ActiveAccountProvider>
                </AppLockProvider>
              </AuthProvider>
            </CookieConsentProvider>
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
      <PersistentAppShell pathname={pathname} />
      <PWAUpdateToast />
      <CookieConsentBanner />
      <Toaster position="top-center" />
      <ConfirmDialogHost />
    </>
  );
}

/**
 * Shell persistente no nível do root. Para rotas autenticadas do app,
 * envolve <Outlet /> com um único <MobileShell> que NÃO remonta entre
 * navegações — apenas o conteúdo da rota troca dentro do mesmo shell.
 *
 * Para rotas públicas (login, landing, termos, etc.) renderiza apenas
 * <Outlet /> e deixa a própria página decidir o layout (AuthShell,
 * PublicLanding, etc.).
 *
 * Páginas internas que ainda chamam <MobileShell> diretamente passam a
 * detectar o contexto persistente e se tornam pass-through (ver
 * MobileShell.tsx) — não há sidebar/topbar/bottomnav duplicados.
 */
const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/cadastro",
  "/recuperar-senha",
  "/reset-password",
  "/confirmar",

  "/termos",
  "/privacidade",
  "/lgpd",
  "/status",
  "/onboarding",
  "/aceitar-convite",
  "/app/idioma", // página decide sozinha entre público e shell
  "/pt",
  "/en",
];

const WIDE_EXACT = new Set<string>([
  "/",
  "/relatorios",
  "/orcamento",
  "/meu-plano",
  "/contas-conectadas",
  "/admin",
  "/resumo",
  "/radar",
  "/alertas",
  "/guardado",
  "/gasto-ai",
]);

const WIDE_PREFIXES = [
  "/gastos",
  "/cartoes",
  "/contas-a-pagar",
  "/contas-a-receber",
  "/assinaturas",
  "/metas",
  "/renda",
  "/mercado",
  "/investimentos",
];

function isPublicPath(p: string) {
  // Raiz é sempre pública (landing page). Nunca envolve MobileShell.
  if (p === "/") return true;
  for (const pre of PUBLIC_PATH_PREFIXES) {
    if (p === pre || p.startsWith(pre + "/")) return true;
  }
  return false;
}

function isWidePath(p: string) {
  if (WIDE_EXACT.has(p)) return true;
  for (const pre of WIDE_PREFIXES) {
    if (p === pre || p.startsWith(pre + "/")) return true;
  }
  return false;
}

function PersistentAppShell({ pathname }: { pathname: string }) {
  const isPublic = isPublicPath(pathname);
  const wide = isWidePath(pathname);

  if (isPublic) {
    return <Outlet />;
  }
  return (
    <MobileShell wide={wide}>
      <Outlet />
    </MobileShell>
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
