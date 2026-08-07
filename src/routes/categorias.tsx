import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/categorias")({
  beforeLoad: () => {
    throw redirect({ to: "/app/ajustes/preferencias-financeiras" });
  },
});
