import React from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
  Link,
  useLocation,
} from "@tanstack/react-router";
import { BottomNav } from "../../../src/components/BottomNav";
import { NAV_GROUPS } from "../../../src/lib/nav-groups";
import { ThemeProvider, useTheme } from "../../../src/lib/theme";
import { AccentProvider } from "../../../src/lib/accent";
import nav from "../../../src/i18n/locales/pt/nav.json";

// Component fixture only: no session, auth mock, financial data or backend.
const destinations = [
  { to: "/app", labelKey: "dashboard" },
  ...NAV_GROUPS.flatMap((g) => g.items),
].filter((item) =>
  [
    "/app",
    "/gastos",
    "/renda",
    "/contas-a-pagar",
    "/contas-a-receber",
    "/cartoes",
    "/assinaturas",
    "/orcamento",
    "/guardado",
    "/metas",
    "/relatorios",
    "/mercado",
    "/bens",
  ].includes(item.to),
);
function Shell() {
  const { setTheme, resolved } = useTheme();
  const { pathname } = useLocation();
  return (
    <>
      <header style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
        <strong>Gasto Inteligente</strong>
        <p style={{ fontSize: 11, marginTop: 6 }}>TESTE ISOLADO DE NAVEGAÇÃO · SEM SESSÃO</p>
        <button
          id="theme"
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
          style={{ marginTop: 12 }}
        >
          Tema: {resolved}
        </button>
      </header>
      <main style={{ padding: "24px 20px var(--mobile-nav-clearance)" }}>
        <div id="route-path">{pathname}</div>
        <Outlet />
        <label htmlFor="search">Busca de teste</label>
        <input
          id="search"
          placeholder="Digite para testar o teclado"
          style={{
            display: "block",
            width: "100%",
            margin: "12px 0 24px",
            padding: 14,
            border: "1px solid var(--border)",
            borderRadius: 14,
          }}
        />
        {Array.from({ length: 16 }, (_, i) => (
          <article
            key={i}
            style={{
              padding: 24,
              marginTop: 12,
              border: "1px solid var(--border)",
              borderRadius: 20,
              background: "var(--card)",
            }}
          >
            Item de teste {i + 1}
            <p style={{ fontSize: 13, marginTop: 8 }}>
              Área de rolagem para verificar a navegação.
            </p>
          </article>
        ))}
        <button id="last-item" style={{ marginTop: 20, padding: 16 }}>
          Último botão de teste
        </button>
      </main>
      <BottomNav />
    </>
  );
}
const root = createRootRoute({ component: Shell });
const routes = destinations.map((item) =>
  createRoute({
    getParentRoute: () => root,
    path: item.to,
    component: () => (
      <h1 style={{ fontSize: 28, margin: "12px 0 24px" }}>{(nav.items as any)[item.labelKey]}</h1>
    ),
  }),
);
routes.push(
  createRoute({
    getParentRoute: () => root,
    path: "/app/mais",
    component: () => (
      <>
        <h1>Mais opções</h1>
        <nav id="more-links" style={{ display: "grid", gap: 8, margin: "16px 0" }}>
          {destinations.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}
            >
              {(nav.items as any)[item.labelKey]}
            </Link>
          ))}
        </nav>
      </>
    ),
  }),
);
// Reset only this isolated origin so screenshots never inherit the previous test theme.
localStorage.setItem("gf-theme", "dark");
const router = createRouter({ routeTree: root.addChildren(routes), defaultPreload: false });
createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <AccentProvider>
      <RouterProvider router={router} />
    </AccentProvider>
  </ThemeProvider>,
);
