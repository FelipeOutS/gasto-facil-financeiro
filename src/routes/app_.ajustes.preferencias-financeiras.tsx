import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app/ajustes/preferencias-financeiras")({
  beforeLoad: () => {
    // This route is a canonical wrapper around /categorias for now,
    // but the plan says to redirect /categorias to here in the future.
    // However, the prompt asks to create /app/ajustes/preferencias-financeiras
    // as the canonical route and redirect legacy /categorias to it.
  },
});
