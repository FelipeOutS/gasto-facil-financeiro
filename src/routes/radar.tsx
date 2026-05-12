import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MobileShell } from "@/components/MobileShell";
import {
  RadarDetalhesDialog,
  RadarEconomicoCard,
} from "@/components/RadarEconomicoCard";
import { getEconomicRadar } from "@/server/radar.functions";

type Status = "atualizado" | "cache" | "desatualizado";
interface Indicator {
  key: string;
  name: string;
  value: number;
  currency: string | null;
  source: string;
  variationPercent: number | null;
  high: number | null;
  low: number | null;
  fetchedAt: string;
  status: Status;
}
interface RadarResult {
  indicators: Indicator[];
  status: Status;
  fetchedAt: string;
  message?: string;
}

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
  const fetchRadar = useServerFn(getEconomicRadar);
  const [data, setData] = useState<RadarResult | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = async () => {
    setLoading(true);
    try {
      const r = await fetchRadar();
      setData(r as RadarResult);
    } catch {
      setData({
        indicators: [],
        status: "desatualizado",
        fetchedAt: new Date(0).toISOString(),
        message:
          "Não conseguimos carregar as cotações agora. Tente novamente em instantes.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <h2 className="text-sm font-semibold">Detalhes e conversor</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Use o conversor para estimar quanto uma compra em dólar ou euro pode
          custar em reais.
        </p>
        <div className="mt-3">
          {/* Renderiza o conteúdo do modal inline para facilitar acesso direto */}
          <RadarDetalhesInline
            data={data}
            loading={loading}
            onRefresh={carregar}
          />
        </div>
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

/**
 * Reaproveita o modal de detalhes, mas mostra inline (sem Dialog) na página
 * dedicada — para isso usamos um truque simples: sempre `open` e ignoramos o
 * onOpenChange. Como o usuário já está numa página dedicada, abrir um modal
 * em cima seria redundante.
 */
function RadarDetalhesInline({
  data,
  loading,
  onRefresh,
}: {
  data: RadarResult | null;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  // Mantém o modal sempre aberto na página dedicada
  useEffect(() => {
    if (!open) setOpen(true);
  }, [open]);
  return (
    <RadarDetalhesDialog
      open={open}
      onOpenChange={() => {
        /* no-op na página dedicada */
      }}
      data={data}
      loading={loading}
      onRefresh={onRefresh}
    />
  );
}
