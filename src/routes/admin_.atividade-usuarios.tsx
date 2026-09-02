import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MobileShell } from "@/components/MobileShell";
import { AdminMasterGate } from "@/components/AdminMasterGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Download, RefreshCcw, UserCheck } from "lucide-react";
import {
  getUserActivityReport,
  type UserActivityReport,
  type UserActivityRow,
} from "@/lib/user-activity.functions";

export const Route = createFileRoute("/admin_/atividade-usuarios")({
  head: () => ({
    meta: [
      { title: "Atividade dos usuários — Gasto Inteligente" },
      {
        name: "description",
        content:
          "Painel interno do Admin Master com último acesso, ações realizadas e retenção por usuário.",
      },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: "Atividade dos usuários — Gasto Inteligente" },
      {
        property: "og:description",
        content: "Último acesso, ações realizadas e retenção por usuário.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AdminMasterGate>
      <AtividadeUsuariosPage />
    </AdminMasterGate>
  ),
});

const WINDOWS = [7, 30, 90] as const;

const SITUACAO_LABEL: Record<UserActivityRow["situacao"], string> = {
  ativo: "Ativo",
  sem_lancamento: "Entrou, não lançou",
  em_risco: "Em risco",
  inativo: "Inativo",
  nunca_acessou: "Nunca acessou",
};

const SITUACAO_VARIANT: Record<
  UserActivityRow["situacao"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  ativo: "default",
  sem_lancamento: "secondary",
  em_risco: "outline",
  inativo: "destructive",
  nunca_acessou: "destructive",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function AtividadeUsuariosPage() {
  const fetchReport = useServerFn(getUserActivityReport);
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<UserActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | UserActivityRow["situacao"]>("todos");

  const load = useCallback(
    async (windowDays: number) => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchReport({ data: { days: windowDays } });
        setData(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao carregar o relatório.");
      } finally {
        setLoading(false);
      }
    },
    [fetchReport],
  );

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data?.usuarios ?? []).filter((u) => {
      if (filtro !== "todos" && u.situacao !== filtro) return false;
      if (!termo) return true;
      return (
        u.email.toLowerCase().includes(termo) || (u.nome ?? "").toLowerCase().includes(termo)
      );
    });
  }, [data, busca, filtro]);

  const exportCsv = useCallback(() => {
    const head = [
      "email",
      "nome",
      "plano",
      "cadastro",
      "ultimo_acesso",
      "dias_sem_acessar",
      "ultima_acao",
      "tipo_ultima_acao",
      "gastos",
      "receitas",
      "contas",
      "outros",
      "total_acoes",
      "dias_ativos",
      "situacao",
    ];
    const linhas = lista.map((u) =>
      [
        u.email,
        u.nome ?? "",
        u.plano ?? "",
        u.criadoEm,
        u.ultimoAcesso ?? "",
        u.diasSemAcessar ?? "",
        u.ultimaAcao ?? "",
        u.ultimaAcaoTipo ?? "",
        u.gastos,
        u.receitas,
        u.contas,
        u.outros,
        u.totalLancamentos,
        u.diasAtivos,
        SITUACAO_LABEL[u.situacao],
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[head.join(","), ...linhas].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atividade-usuarios-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [lista, days]);

  const totais = data?.totais;

  return (
    <MobileShell wide>
      <div className="pt-4 sm:pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
              <UserCheck className="h-5 w-5" /> Atividade dos usuários
            </h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Último acesso, o que cada pessoa fez na conta e quem está voltando. Sem valores
              financeiros — apenas datas e contagem de ações.
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
            <Button variant="outline" onClick={exportCsv} className="gap-2">
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={days === w ? "default" : "outline"}
              onClick={() => setDays(w)}
            >
              Ações dos últimos {w} dias
            </Button>
          ))}
        </div>

        {error && (
          <Card className="mt-4 border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {loading && !data ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          totais && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard label="Contas totais" value={totais.usuarios} />
                <MetricCard label="Acessaram nas últimas 24h" value={totais.ativos24h} />
                <MetricCard label="Acessaram nos últimos 7 dias" value={totais.ativos7d} />
                <MetricCard
                  label={`Acessaram nos últimos ${data?.janelaDias} dias`}
                  value={totais.acessaramNaJanela}
                />
                <MetricCard label="Fizeram ao menos 1 ação" value={totais.comLancamentos} />
                <MetricCard label="Sem nenhuma ação" value={totais.semLancamentos} />
                <MetricCard label="Usaram em mais de um dia" value={totais.retornaram} />
                <MetricCard label="Nunca acessaram" value={totais.nuncaAcessaram} />
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por e-mail ou nome"
                  className="sm:max-w-xs"
                />
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      "todos",
                      "ativo",
                      "sem_lancamento",
                      "em_risco",
                      "inativo",
                      "nunca_acessou",
                    ] as const
                  ).map((f) => (
                    <Button
                      key={f}
                      size="sm"
                      variant={filtro === f ? "default" : "outline"}
                      onClick={() => setFiltro(f)}
                    >
                      {f === "todos" ? "Todos" : SITUACAO_LABEL[f]}
                    </Button>
                  ))}
                </div>
              </div>

              <Card className="mt-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Usuários ({lista.length}) — ordenados pelo acesso mais recente
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Plano</TableHead>
                        <TableHead>Último acesso</TableHead>
                        <TableHead className="text-right">Dias sem entrar</TableHead>
                        <TableHead>Última ação na conta</TableHead>
                        <TableHead className="text-right">Gastos</TableHead>
                        <TableHead className="text-right">Receitas</TableHead>
                        <TableHead className="text-right">Contas</TableHead>
                        <TableHead className="text-right">Outros</TableHead>
                        <TableHead className="text-right">Dias com uso</TableHead>
                        <TableHead>Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lista.map((u) => (
                        <TableRow key={u.userId}>
                          <TableCell className="max-w-[220px]">
                            <div className="truncate font-medium">{u.nome ?? "—"}</div>
                            <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                            <div className="text-xs text-muted-foreground">
                              Cadastro: {fmtDate(u.criadoEm)}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{u.plano ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {fmtDate(u.ultimoAcesso)}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {u.diasSemAcessar ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {u.ultimaAcaoTipo ? (
                              <>
                                <div>{u.ultimaAcaoTipo}</div>
                                <div className="text-muted-foreground">
                                  {fmtDate(u.ultimaAcao)}
                                </div>
                              </>
                            ) : (
                              <span className="text-muted-foreground">
                                Nenhuma ação na janela
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs">{u.gastos}</TableCell>
                          <TableCell className="text-right text-xs">{u.receitas}</TableCell>
                          <TableCell className="text-right text-xs">{u.contas}</TableCell>
                          <TableCell className="text-right text-xs">{u.outros}</TableCell>
                          <TableCell className="text-right text-xs">{u.diasAtivos}</TableCell>
                          <TableCell>
                            <Badge variant={SITUACAO_VARIANT[u.situacao]}>
                              {SITUACAO_LABEL[u.situacao]}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {lista.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={11} className="text-center text-sm text-muted-foreground">
                            Nenhum usuário para este filtro.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <p className="mt-3 text-xs text-muted-foreground">
                Relatório gerado em {fmtDate(data?.geradoEm ?? null)}. "Último acesso" vem do
                registro de login da conta; as contagens de ações consideram apenas a janela
                selecionada.
              </p>
            </>
          )
        )}
      </div>
    </MobileShell>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
