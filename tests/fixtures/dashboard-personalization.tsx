import React from "react";
import { createRoot } from "react-dom/client";
import { DashboardBlock, PersonalizedDashboard } from "../../src/components/dashboard/PersonalizedDashboard";
import { DASHBOARD_BLOCKS } from "../../src/lib/dashboard-layout";
createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-5xl p-4">
  <h1>Dashboard — dados sintéticos</h1>
  <PersonalizedDashboard userId="synthetic-visual-test">
    {DASHBOARD_BLOCKS.map(block => <DashboardBlock key={block.id} id={block.id}><section className="mt-4 rounded-2xl border border-border bg-card p-4">{block.label}</section></DashboardBlock>)}
  </PersonalizedDashboard>
</main>);
