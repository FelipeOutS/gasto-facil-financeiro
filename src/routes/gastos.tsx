import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Search, Trash2 } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { CategoryIcon } from "@/components/CategoryIcon";
import {
  deleteGasto,
  getCategoriaById,
  getCategorias,
  getGastos,
  useBootstrap,
  useStore,
} from "@/lib/store";
import { formatBRL, formatDateBR } from "@/lib/format";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FORMAS_PAGAMENTO } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/gastos")({
  head: () => ({ meta: [{ title: "Gastos — Gasto Fácil" }] }),
  component: GastosPage,
});

function GastosPage() {
  const ready = useBootstrap();
  const gastos = useStore(() => getGastos());
  const categorias = useStore(() => getCategorias());
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState<string>("todas");
  const [pagFilter, setPagFilter] = useState<string>("todas");
  const [order, setOrder] = useState<string>("recente");

  const filtered = useMemo(() => {
    let list = [...gastos];
    if (catFilter !== "todas") list = list.filter((g) => g.categoriaId === catFilter);
    if (pagFilter !== "todas") list = list.filter((g) => g.formaPagamento === pagFilter);
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      list = list.filter(
        (g) =>
          g.descricao.toLowerCase().includes(t) ||
          g.estabelecimento.toLowerCase().includes(t),
      );
    }
    switch (order) {
      case "antigo":
        list.sort((a, b) => (a.data < b.data ? -1 : 1));
        break;
      case "maior":
        list.sort((a, b) => b.valor - a.valor);
        break;
      case "menor":
        list.sort((a, b) => a.valor - b.valor);
        break;
      default:
        list.sort((a, b) => (a.data > b.data ? -1 : 1));
    }
    return list;
  }, [gastos, q, catFilter, pagFilter, order]);

  const total = filtered.reduce((s, g) => s + g.valor, 0);

  if (!ready) return <MobileShell><div /></MobileShell>;

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Histórico</p>
          <h1 className="text-2xl font-bold tracking-tight">Gastos</h1>
        </div>
      </header>

      <div className="mt-4 rounded-3xl border border-border bg-card p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou estabelecimento"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-11 bg-card-elevated pl-9"
          />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="h-9 bg-card-elevated text-xs">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas categorias</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={pagFilter} onValueChange={setPagFilter}>
            <SelectTrigger className="h-9 bg-card-elevated text-xs">
              <SelectValue placeholder="Pagamento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos pagamentos</SelectItem>
              {FORMAS_PAGAMENTO.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={order} onValueChange={setOrder}>
            <SelectTrigger className="h-9 bg-card-elevated text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recente">Mais recente</SelectItem>
              <SelectItem value="antigo">Mais antigo</SelectItem>
              <SelectItem value="maior">Maior valor</SelectItem>
              <SelectItem value="menor">Menor valor</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {filtered.length} {filtered.length === 1 ? "gasto" : "gastos"}
        </span>
        <span className="num font-medium text-foreground">{formatBRL(total)}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">
          Nenhum gasto encontrado.
        </div>
      ) : (
        <ul className="mt-3 space-y-2 pb-4">
          {filtered.map((g) => {
            const cat = getCategoriaById(g.categoriaId);
            const pag = FORMAS_PAGAMENTO.find((f) => f.id === g.formaPagamento)?.label;
            return (
              <li
                key={g.id}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
              >
                <CategoryIcon categoria={cat} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {g.estabelecimento || g.descricao}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {cat?.nome ?? "Outros"} · {formatDateBR(g.data)} · {pag}
                    {g.tipoGasto === "parcelado" && g.totalParcelas
                      ? ` · ${g.parcelaAtual}/${g.totalParcelas}`
                      : g.tipoGasto === "recorrente"
                        ? " · recorrente"
                        : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <p className="num text-sm font-semibold">{formatBRL(g.valor)}</p>
                  <button
                    onClick={() => {
                      deleteGasto(g.id);
                      toast.success("Gasto removido");
                    }}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Excluir"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </MobileShell>
  );
}
