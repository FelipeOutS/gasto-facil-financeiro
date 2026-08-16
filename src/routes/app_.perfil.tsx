import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Rota legada de perfil. Consolidada em `/conta` (rota canônica).
 * Mantida apenas como redirect permanente para preservar URLs antigas.
 */
export const Route = createFileRoute("/app_/perfil")({
  beforeLoad: () => {
    throw redirect({ to: "/conta", replace: true });
  },
});
