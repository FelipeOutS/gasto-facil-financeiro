import { createFileRoute, redirect } from "@tanstack/react-router";

// Rota legada: redireciona /landing -> / para manter URL principal limpa
// e preservar links antigos.
export const Route = createFileRoute("/landing")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
  component: () => null,
});
