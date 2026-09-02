import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MobileShell } from "@/components/MobileShell";
import { AdminMasterGate } from "@/components/AdminMasterGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, BarChart3, ChevronRight, RefreshCcw, Users } from "lucide-react";
import {
  getProductUsageReport,
  type ProductUsageReport,
} from "@/lib/product-analytics.functions";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export const Route = createFileRoute("/admin_/uso-produto")({
  head: () => ({
    meta: [
      { title: "Uso do produto — Gasto Inteligente" },
      {
        name: "description",
        content: "Painel interno com métricas agregadas de navegação e uso das funcionalidades.",
      },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: "Uso do produto — Gasto Inteligente" },
      {
        property: "og:description",
        content: "Painel interno com métricas agregadas de navegação e uso das funcionalidades.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AdminMasterGate>
      <UsoProdutoPage />
    </AdminMasterGate>
  ),
});

const WINDOWS = [7, 30, 90] as const;

function UsoProdutoPage() {
  const fetchReport = useServerFn(getProductUsageReport);
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<ProductUsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buscaUsuario, setBuscaUsuario] = useState("");
  const [aberto, setAberto] = useState<Record<string, boolean>>({});

  const usuariosFiltrados = useMemo(() => {
    const termo = buscaUsuario.trim().toLowerCase();
    return (data?.byUser ?? []).filter(
      (u) =>
        !termo ||
        u.email.toLowerCase().includes(termo) ||
        (u.nome ?? "").toLowerCase().includes(termo),
    );
  }, [data, buscaUsuario]);


  const load = useCallback(
    async (windowDays: number) => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchReport({ data: { days: windowDays } });
        setData(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao carregar métricas.");
      } finally {
        setLoading(false);
      }
    },
    [fetchReport],
  );

  useEffect(() => {
    void load(days);
  }, [days, load]);

  return (
    <MobileShell wide>
      <div className="pt-4 sm:pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
              <BarChart3 className="h-5 w-5" /> Uso do produto
            </h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Somente números agregados de navegação e uso de funcionalidades. Nenhum dado pessoal
              ou financeiro é coletado.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild className="gap-2">
              <a href="/admin">
                <ArrowLeft className="h-4 w-4" /> Admin
              </a>
            </Button>
            <Button variant="outline" onClick={() => void load(days)} className="gap-2">
              <RefreshCcw className="h-4 w-4" /> Atualizar
            </Button>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={days === w ? "default" : "outline"}
              onClick={() => setDays(w)}
            >
              {w} dias
            </Button>
          ))}
        </div>

        {data?.dataStartAt && (
          <p className="mt-3 text-xs text-muted-foreground">
            Início confiável dos dados (deploy da Fase 2):{" "}
            {new Date(data.dataStartAt).toLocaleString("pt-BR")}. Nenhum histórico anterior foi
            mesclado a esta taxonomia.
          </p>
        )}

        {error && (
          <Card className="mt-4 border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {loading && !data ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : data ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-6">
              <Metric label="DAU" value={data.active.dau} icon />
              <Metric label="WAU" value={data.active.wau} icon />
              <Metric label="MAU" value={data.active.mau} icon />
              <Metric label="Eventos" value={data.totals.events} />
              <Metric label="Sessões" value={data.totals.sessions} />
              <Metric label="Usuários" value={data.totals.users} />
            </div>

            <Card className="mt-5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Relatório por usuário ({data.byUser.length}) — clique para ver página por página
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <div className="mb-3">
                  <Input
                    value={buscaUsuario}
                    onChange={(e) => setBuscaUsuario(e.target.value)}
                    placeholder="Buscar por e-mail ou nome"
                    className="sm:max-w-xs"
                  />
                </div>
                {usuariosFiltrados.length === 0 ? (
                  <p className="py-4 text-xs text-muted-foreground">
                    Sem eventos de usuários identificados no período.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Plano</TableHead>
                        <TableHead className="text-right">Telas vistas</TableHead>
                        <TableHead className="text-right">Cliques no menu</TableHead>
                        <TableHead className="text-right">Sessões</TableHead>
                        <TableHead className="text-right">Dias com uso</TableHead>
                        <TableHead>Primeiro evento</TableHead>
                        <TableHead>Último evento</TableHead>
                        <TableHead>Plataformas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usuariosFiltrados.map((u) => (
                        <Fragment key={u.userId}>
                          <TableRow
                            key={u.userId}
                            className="cursor-pointer"
                            onClick={() =>
                              setAberto((prev) => ({ ...prev, [u.userId]: !prev[u.userId] }))
                            }
                          >
                            <TableCell className="max-w-[220px]">
                              <div className="flex items-center gap-1 truncate font-medium">
                                <ChevronRight
                                  className={`h-3.5 w-3.5 shrink-0 transition-transform ${aberto[u.userId] ? "rotate-90" : ""}`}
                                />
                                {u.nome ?? "—"}
                              </div>
                              <div className="truncate pl-4 text-xs text-muted-foreground">
                                {u.email}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">{u.plano ?? "—"}</TableCell>
                            <TableCell className="text-right text-xs">{u.pageViews}</TableCell>
                            <TableCell className="text-right text-xs">{u.navClicks}</TableCell>
                            <TableCell className="text-right text-xs">{u.sessions}</TableCell>
                            <TableCell className="text-right text-xs">{u.activeDays}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {fmtDate(u.firstSeen)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {fmtDate(u.lastSeen)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {u.platforms.join(", ") || "—"}
                            </TableCell>
                          </TableRow>
                          {aberto[u.userId] && (
                            <TableRow key={`${u.userId}-detalhe`} className="bg-muted/40">
                              <TableCell colSpan={9}>
                                {u.routes.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    Nenhuma tela registrada para este usuário no período.
                                  </p>
                                ) : (
                                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                                    {u.routes.map((r) => (
                                      <div
                                        key={r.route}
                                        className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1 text-xs"
                                      >
                                        <span className="truncate">{r.route}</span>
                                        <span className="shrink-0 text-muted-foreground">
                                          {r.views} · {fmtDate(r.lastViewAt)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Relatório por página ({data.topRoutes.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {data.topRoutes.length === 0 ? (
                  <p className="py-4 text-xs text-muted-foreground">Sem dados no período.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Página</TableHead>
                        <TableHead className="text-right">Views</TableHead>
                        <TableHead className="text-right">Usuários únicos</TableHead>
                        <TableHead className="text-right">Sessões</TableHead>
                        <TableHead>Última visita</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topRoutes.map((r) => (
                        <TableRow key={r.route}>
                          <TableCell className="text-xs">{r.route}</TableCell>
                          <TableCell className="text-right text-xs">{r.views}</TableCell>
                          <TableCell className="text-right text-xs">{r.users}</TableCell>
                          <TableCell className="text-right text-xs">{r.sessions}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {fmtDate(r.lastViewAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <ListCard
                title="Origem dos cliques de navegação"
                columns={["Origem", "Cliques"]}
                rows={data.bySource.map((r) => [r.source, r.clicks])}
              />
              <ListCard
                title="Eventos por tipo"
                columns={["Evento", "Total"]}
                rows={data.byEvent.map((r) => [r.event, r.count])}
              />
              <ListCard
                title="Plataforma"
                columns={["Plataforma", "Eventos"]}
                rows={data.byPlatform.map((r) => [r.platform, r.events])}
              />
              <ListCard
                title="Atividade por dia"
                columns={["Dia", "Eventos", "Usuários"]}
                rows={data.byDay.map((r) => [r.day, r.events, r.users])}
              />
            </div>
          </>
        ) : null}
      </div>
    </MobileShell>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon?: boolean }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3 sm:p-4">
        {icon && <Users className="h-4 w-4 text-muted-foreground" />}
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value.toLocaleString("pt-BR")}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ListCard({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">Sem dados no período.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c}>{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 25).map((row, i) => (
                <TableRow key={`${row[0]}-${i}`}>
                  {row.map((cell, j) => (
                    <TableCell key={j} className="text-xs">
                      {typeof cell === "number" ? cell.toLocaleString("pt-BR") : cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
