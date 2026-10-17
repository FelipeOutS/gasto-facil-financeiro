import { useState } from "react";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { MobileShell } from "../../../src/components/MobileShell";
import { MobileMonthSummary } from "../../../src/components/MobileMonthSummary";
import {
  DashboardOverview,
  DashboardCards,
} from "../../../src/components/dashboard/DashboardOverview";
import {
  RecentTransactionsCard,
  LimiteMensalCard,
} from "../../../src/components/dashboard/DashboardFinancialCards";
import {
  PersonalizedDashboard,
  DashboardBlock,
} from "../../../src/components/dashboard/PersonalizedDashboard";
import { FluxoCaixaChart } from "../../../src/components/FluxoCaixaChart";
import { ThemeProvider } from "../../../src/lib/theme";
import { AccentProvider } from "../../../src/lib/accent";
import { NAV_GROUPS } from "../../../src/lib/nav-groups";
import { gastos, receitas } from "./mocks";
import { ThemeToggle } from "../../../src/components/ThemeToggle";
function Dashboard() {
  const [month, setMonth] = useState(10);
  const [empty, setEmpty] = useState(false);
  return (
    <div className="premium-dashboard">
      <div role="note" className="finexy-preview-note">
        PRÉVIA ISOLADA · DADOS FICTÍCIOS · SEM BANCO{" "}
        <button onClick={() => setEmpty(!empty)} className="underline">
          {empty ? "Mostrar dados de teste" : "Testar estado vazio"}
        </button>
      </div>
      <header className="premium-greeting">
        <p className="text-xs text-muted-foreground">SEU RESUMO FINANCEIRO</p>
        <h1>Boa noite, Marina</h1>
        <p className="text-sm text-muted-foreground">
          Acompanhe suas finanças e mantenha seus objetivos em dia.
        </p>
      </header>
      <div className="lg:hidden">
        <MobileMonthSummary
          ano={2026}
          mes={month}
          saldo={empty ? 0 : 8300}
          receitas={empty ? 0 : 12000}
          despesas={empty ? 0 : 3700}
          guardado={empty ? 0 : 4500}
          aPagar={empty ? 0 : 980}
          atrasadasCount={0}
          pendentesCount={empty ? 0 : 2}
          onPrev={() => setMonth(Math.max(1, month - 1))}
          onNext={() => setMonth(Math.min(12, month + 1))}
        />
      </div>
      <div className="premium-period hidden lg:flex justify-between">
        <h2>Resumo de {month}/2026</h2>
        <div>
          <button
            className="min-h-11 px-4"
            aria-label="Mês anterior"
            onClick={() => setMonth(Math.max(1, month - 1))}
          >
            ←
          </button>
          <button
            className="min-h-11 px-4"
            aria-label="Próximo mês"
            onClick={() => setMonth(Math.min(12, month + 1))}
          >
            →
          </button>
        </div>
      </div>
      <DashboardOverview
        saldo={empty ? 0 : 8300}
        totalEntradas={empty ? 0 : 12000}
        total={empty ? 0 : 3700}
        totalGuardado={empty ? 0 : 4500}
        aPagar={empty ? 0 : 980}
        atrasadasCount={0}
        pendentesCount={empty ? 0 : 2}
        chart={
          <FluxoCaixaChart
            compact
            ano={2026}
            mes={month}
            gastos={empty ? [] : gastos}
            receitas={empty ? [] : receitas}
          />
        }
        budget={
          <LimiteMensalCard
            total={empty ? 0 : 3700}
            limiteTotal={empty ? 0 : 6000}
            usoLimite={empty ? 0 : 61.67}
            passouLimite={false}
            proximoLimite={false}
          />
        }
        cards={
          <DashboardCards
            cartoes={
              empty
                ? []
                : [
                    {
                      id: "test-card-1",
                      nome: "Cartão demonstração",
                      banco: "Banco de teste",
                      limiteTotal: 6000,
                      diaFechamento: 5,
                      diaVencimento: 12,
                      cor: "",
                      criadoEm: "",
                      atualizadoEm: "",
                    },
                    {
                      id: "test-card-2",
                      nome: "Cartão exemplo",
                      banco: "Banco fictício",
                      limiteTotal: 4000,
                      diaFechamento: 10,
                      diaVencimento: 17,
                      cor: "",
                      criadoEm: "",
                      atualizadoEm: "",
                    },
                  ]
            }
          />
        }
        transactions={<RecentTransactionsCard ultimos={empty ? [] : gastos.slice(-5).reverse()} />}
      />
      <div className="lg:hidden">
        <PersonalizedDashboard userId="isolated-premium-fixture">
          <DashboardBlock id="radar">
            <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              <div className="xl:col-span-8 min-w-0">
                <FluxoCaixaChart
                  ano={2026}
                  mes={month}
                  gastos={empty ? [] : gastos}
                  receitas={empty ? [] : receitas}
                />
              </div>
              <div className="xl:col-span-4">
                <LimiteMensalCard
                  total={empty ? 0 : 3700}
                  limiteTotal={6000}
                  usoLimite={empty ? 0 : 61.67}
                  passouLimite={false}
                  proximoLimite={false}
                />
              </div>
            </section>
          </DashboardBlock>
          <DashboardBlock id="visao">
            <RecentTransactionsCard ultimos={empty ? [] : gastos.slice(-5).reverse()} />
          </DashboardBlock>
        </PersonalizedDashboard>
      </div>
    </div>
  );
}
function Shell() {
  return (
    <MobileShell wide unprotected>
      <Outlet />
    </MobileShell>
  );
}
const root = createRootRoute({ component: Shell });
const paths = [
  "/app",
  "/conta",
  "/adicionar",
  "/renda/nova",
  "/app/mais",
  ...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to)),
];
const routes = [...new Set(paths)].map((path) =>
  createRoute({
    getParentRoute: () => root,
    path,
    component:
      path === "/app"
        ? Dashboard
        : () => (
            <div className="p-8">
              <h1>{path}</h1>
              <p>Destino de teste. Nenhum dado é gravado.</p>
            </div>
          ),
  }),
);
const router = createRouter({ routeTree: root.addChildren(routes) });
createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <AccentProvider>
      <RouterProvider router={router} />
    </AccentProvider>
  </ThemeProvider>,
);
