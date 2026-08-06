import { createRouter, Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { routeTree } from "./routeTree.gen";

function isRecoverableRouteLoadError(error: Error) {
  const text = `${error.name} ${error.message} ${error.stack ?? ""}`.toLowerCase();
  return (
    text.includes("failed to fetch dynamically imported module") ||
    text.includes("importing a module script failed") ||
    text.includes("loading chunk") ||
    text.includes("dynamically imported") ||
    text.includes("modulepreload")
  );
}

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isRouteLoadError = isRecoverableRouteLoadError(error);

  useEffect(() => {
    console.error("[Router error boundary]", { pathname, error });

    if (!isRouteLoadError || typeof window === "undefined") return;
    const key = `gi:route-reload:${pathname}`;
    try {
      if (window.sessionStorage.getItem(key) === "1") {
        console.warn("[Router error boundary] Reload loop detected, stopping.");
        return;
      }
      window.sessionStorage.setItem(key, "1");
      
      // If it's a chunk load error, try to clear cache before reload
      if ("caches" in window) {
        void caches.keys().then((names) => {
          for (const name of names) void caches.delete(name);
        });
      }

      window.location.reload();
    } catch {
      window.location.reload();
    }
  }, [error, isRouteLoadError, pathname]);

  return (
    <div className="fixed inset-0 z-[10000] flex min-h-screen min-h-dvh items-center justify-center overflow-auto bg-background px-4 text-foreground">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Algo deu errado</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isRouteLoadError
            ? "Estamos atualizando esta tela. Se ela não recarregar automaticamente, tente novamente."
            : "Não conseguimos carregar esta tela. Tente novamente em alguns instantes."}
        </p>
        {import.meta.env.DEV && error.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              if (isRouteLoadError && typeof window !== "undefined") {
                window.location.reload();
                return;
              }
              void router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Tentar novamente
          </button>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Ir para o início
          </Link>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    // Pré-carrega chunks de rotas assim que os <Link> aparecem na viewport
    // (BottomNav, Sidebar, listas de navegação). No mobile/WebView não existe
    // hover, então "intent" só dispara no toque — o que causa o atraso
    // perceptível na navegação. Com "viewport", quando o usuário tocar o
    // botão, o chunk já está em cache e a troca de tela é instantânea.
    defaultPreload: "viewport",
    defaultPreloadDelay: 50,
    // Mantém rotas pré-carregadas em cache por 5 min para evitar refetch
    // ao alternar entre páginas já visitadas.
    defaultPreloadStaleTime: 5 * 60_000,

    // Sem pending component global: o TanStack Router mantém a página atual
    // visível enquanto a próxima carrega — navegação parece instantânea, sem
    // splash/skeleton entre rotas. Páginas individuais podem mostrar
    // skeletons locais para dados próprios quando fizer sentido.
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
