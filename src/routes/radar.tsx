import { createFileRoute } from "@tanstack/react-router";
import { MobileShell } from "@/components/MobileShell";
import { RadarEconomicoCard } from "@/components/RadarEconomicoCard";

export const Route = createFileRoute("/radar")({
  head: () => ({
    meta: [
      { title: "Radar Econômico — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Acompanhe dólar, euro e o impacto do câmbio nas suas compras e assinaturas.",
      },
      { property: "og:title", content: "Radar Econômico — Gasto Inteligente" },
      {
        property: "og:description",
        content:
          "Cotações de referência do dia e conversor rápido para compras internacionais.",
      },
    ],
  }),
  component: RadarPage,
});

function RadarPage() {
  return (
    <MobileShell>
      <header className="pt-4">
        <h1 className="text-2xl font-semibold">Radar Econômico</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Veja como o dólar e o euro estão hoje e o impacto nas suas compras
          internacionais e assinaturas em moeda estrangeira.
        </p>
      </header>

      <div className="mt-4">
        <RadarEconomicoCard />
      </div>

      <section className="mt-6 rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Como funciona</h2>
        <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Cotação de referência:</span>{" "}
            mostramos os valores de dólar e euro do dia para você acompanhar.
          </li>
          <li>
            <span className="font-medium text-foreground">Conversor rápido:</span>{" "}
            toque no card acima para abrir o conversor e estimar quanto uma
            compra ficaria em reais.
          </li>
          <li>
            <span className="font-medium text-foreground">Estimativa:</span> o
            valor real cobrado pelo cartão pode variar conforme IOF, spread e a
            cotação usada no fechamento da fatura.
          </li>
        </ul>
      </section>

      <section className="mt-6 rounded-2xl border border-dashed bg-muted/30 p-4">
        <h2 className="text-sm font-semibold">Em breve</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Selic e IPCA com dados oficiais do Banco Central</li>
          <li>Histórico e gráfico dos últimos dias</li>
          <li>Alertas quando o dólar variar mais do que você definir</li>
        </ul>
      </section>
    </MobileShell>
  );
}
