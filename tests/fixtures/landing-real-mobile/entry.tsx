import React from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import "@/i18n";
import { ThemeProvider } from "@/lib/theme";
import { AccentProvider } from "@/lib/accent";
import { Route as Dashboard } from "@/routes/app";
import { Route as Metas } from "@/routes/metas.index";
import { Route as Investimentos } from "@/routes/investimentos.index";
import { Route as Guardado } from "@/routes/guardado";
const root = createRootRoute({
  component: () => (
    <ThemeProvider>
      <AccentProvider>
        <Outlet />
      </AccentProvider>
    </ThemeProvider>
  ),
});
const routes = [
  ["/app", Dashboard],
  ["/metas", Metas],
  ["/investimentos", Investimentos],
  ["/guardado", Guardado],
].map(([path, route]: any) =>
  createRoute({ getParentRoute: () => root, path, component: route.options.component }),
);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={createRouter({ routeTree: root.addChildren(routes) })} />,
);
