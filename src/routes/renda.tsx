import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2, TrendingUp, Repeat } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import {
  addReceita,
  deleteReceita,
  getReceitas,
  useBootstrap,
  useStore,
} from "@/lib/store";
import { TIPOS_RECEITA, type TipoReceita } from "@/lib/types";
import { formatBRL, formatDateBR, parseBRLInput, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/renda")({
  head: () => ({ meta: [{ title: "Minha renda — Gasto Fácil" }] }),
  component: RendaPage,
});

function RendaPage() {
  const ready = useBootstrap();
  const receitas = useStore(() => getReceitas());

  const today = new Date();
  const mesAtual = today.getMonth() + 1;
  const anoAtual = today.getFullYear();

  const doMes = useMemo(
    () => receitas.filter((r) => r.mes === mesAtual && r.ano === anoAtual),
    [receitas, mesAtual, anoAtual],
  );
  const totalMes = useMemo(() => doMes.reduce((s, r) => s + r.valor, 0), [doMes]);
  const salarioMes = useMemo(
    () => doMes.filter((r) => r.tipo === "salario").reduce((s, r) => s + r.valor, 0),
    [doMes],
  );
  const outrasMes = totalMes - salarioMes;

  const [open, setOpen] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [valorStr, setValorStr] = useState("");
  const [data, setData] = useState(todayISO());
  const [tipo, setTipo] = useState<TipoReceita>("salario");
  const [recorrente, setRecorrente] = useState(true);
  const [meses, setMeses] = useState(12);

  function reset() {
    setDescricao("");
    setValorStr("");
    setData(todayISO());
    setTipo("salario");
    setRecorrente(true);
    setMeses(12);
  }

  function handleSave() {
    const valor = parseBRLInput(valorStr);
    if (!valor || !descricao.trim()) {
      toast.error("Preencha descrição e valor");
      return;
    }
    addReceita({
      descricao: descricao.trim(),
      valor,
      data,
      tipo,
      recorrente,
      recorrenteMeses: recorrente ? meses : undefined,
    });
    toast.success("Entrada cadastrada");
    setOpen(false);
    reset();
  }

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
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Entradas</p>
          <h1 className="text-2xl font-bold tracking-tight">Minha renda</h1>
        </div>
      </header>

      <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-elevated">
        <p className="text-xs font-medium text-muted-foreground">Total de entradas no mês</p>
        <p className="num mt-1 text-4xl font-extrabold tracking-tight">{formatBRL(totalMes)}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-card-elevated p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Salário</p>
            <p className="num mt-1 text-lg font-semibold">{formatBRL(salarioMes)}</p>
          </div>
          <div className="rounded-2xl bg-card-elevated p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Outras entradas</p>
            <p className="num mt-1 text-lg font-semibold">{formatBRL(outrasMes)}</p>
          </div>
        </div>
      </section>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogTrigger asChild>
          <Button size="lg" className="mt-4 h-14 w-full rounded-2xl text-base font-semibold shadow-elevated">
            <Plus className="mr-1 h-5 w-5" />
            Nova entrada
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova entrada de dinheiro</DialogTitle>
            <DialogDescription>Salário, freelance, comissão e mais.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Descrição</Label>
              <Input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Ex.: Salário do mês"
                className="mt-1 h-11 bg-card-elevated"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Valor</Label>
                <Input
                  inputMode="decimal"
                  value={valorStr}
                  onChange={(e) => setValorStr(e.target.value)}
                  placeholder="0,00"
                  className="num mt-1 h-11 bg-card-elevated"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Data</Label>
                <Input
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                  className="mt-1 h-11 bg-card-elevated"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoReceita)}>
                <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_RECEITA.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-card-elevated px-3 py-2">
              <div>
                <p className="text-sm font-medium">Repetir todo mês</p>
                <p className="text-xs text-muted-foreground">Entrada recorrente</p>
              </div>
              <Switch checked={recorrente} onCheckedChange={setRecorrente} />
            </div>
            {recorrente && (
              <div>
                <Label className="text-xs text-muted-foreground">Repetir por (meses)</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={meses}
                  onChange={(e) => setMeses(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 h-11 bg-card-elevated"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Cadastrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="mt-5">
        <h2 className="text-sm font-semibold">Entradas do mês</h2>
        {doMes.length === 0 ? (
          <div className="mt-3 rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            Nenhuma entrada cadastrada neste mês.
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {doMes.map((r) => {
              const tipoLabel = TIPOS_RECEITA.find((t) => t.id === r.tipo)?.label;
              return (
                <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-success/15 text-success">
                    {r.recorrente ? <Repeat className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.descricao}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {tipoLabel} · {formatDateBR(r.data)}
                      {r.recorrente ? " · recorrente" : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p className="num text-sm font-semibold text-success">+{formatBRL(r.valor)}</p>
                    <button
                      onClick={() => { deleteReceita(r.id); toast.success("Entrada removida"); }}
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
      </section>
    </MobileShell>
  );
}
