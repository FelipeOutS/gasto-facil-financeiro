import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/app_/ajustes/ajuda")({
  head: () => ({ meta: [{ title: "Ajuda e informações — Gasto Inteligente" }] }),
  component: AjudaLayout,
});

function AjudaLayout() {
  return <Outlet />;
}
