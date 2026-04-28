import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2, Wallet, Building2 } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import {
  addBanco,
  addGuardado,
  deleteBanco,
  deleteGuardado,
  getBancos,
  getGuardado,
  useBootstrap,
  useStore,
} from "@/lib/store";
import { TIPOS_RESERVA, type TipoReserva } from "@/lib/types";
import { formatBRL, formatDateBR, parseBRLInput } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { cn } from "@/lib/utils";

const COLOR_OPTIONS = [
  "#820ad1", "#00b1ea", "#ec7000", "#cc092f", "#ec0000", "#fae128",
  "#1c5aa8", "#ff7a00", "#3a3a3a", "#21c25e", "#048b3a", "#0f2a4a",
];

export const Route = createFileRoute("/guardado")({
  head: () => ({ meta: [{ title: "Dinheiro guardado — Gasto Fácil" }] }),
  component: GuardadoPage,
});

function GuardadoPage() {
  const ready = useBootstrap();
  const bancos = useStore(() => getBancos());
  const guardado = useStore(() => getGuardado());

  const total = useMemo(() => guardado.reduce((s, g) => s + g.valor, 0), [guardado]);
  const porBanco = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of guardado) map.set(g.bancoId, (map.get(g.bancoId) ?? 0) + g.valor);
    return map;
  }, [guardado]);

  // Add guardado dialog
  const [openG, setOpenG] = useState(false);
  const [bancoId, setBancoId] = useState<string>(bancos[0]?.id ?? "");
  const [valorStr, setValorStr] = useState("");
  const [tipoReserva, setTipoReserva] = useState<TipoReserva>("emergencia");
  const [obs, setObs] = useState("");

  // Add banco dialog
  const [openB, setOpenB] = useState(false);
  const [novoBancoNome, setNovoBancoNome] = useState("");
  const [novoBancoCor, setNovoBancoCor] = useState(COLOR_OPTIONS[0]);

  function handleSaveGuardado() {
    const valor = parseBRLInput(valorStr);
    if (!valor || !bancoId) {
      toast.error("Selecione banco e valor");
      return;
    }
    addGuardado({ bancoId, valor, tipoReserva, observacao: obs.trim() || undefined });
    toast.success("Valor guardado");
    setValorStr("");
    setObs("");
    setOpenG(false);
  }

  function handleSaveBanco() {
    if (!novoBancoNome.trim()) {
      toast.error("Informe o nome");
      return;
    }
    addBanco({ nome: novoBancoNome.trim(), colorHex: novoBancoCor });
    toast.success("Banco adicionado");
    setNovoBancoNome("");
    setOpenB(false);
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
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Reservas</p>
          <h1 className="text-2xl font-bold tracking-tight">Dinheiro guardado</h1>
        </div>
      </header>

      <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-elevated">
        <p className="text-xs font-medium text-muted-foreground">Total guardado</p>
        <p className="num mt-1 text-4xl font-extrabold tracking-tight">{formatBRL(total)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {guardado.length} {guardado.length === 1 ? "reserva" : "reservas"} em {porBanco.size} {porBanco.size === 1 ? "banco" : "bancos"}
        </p>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Dialog open={openG} onOpenChange={setOpenG}>
          <DialogTrigger asChild>
            <Button size="lg" className="h-12 rounded-2xl text-sm font-semibold">
              <Plus className="mr-1 h-4 w-4" />
              Nova reserva
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cadastrar valor guardado</DialogTitle>
              <DialogDescription>Em qual banco e quanto está guardado.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Banco</Label>
                <Select value={bancoId} onValueChange={setBancoId}>
                  <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {bancos.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  <Label className="text-xs text-muted-foreground">Tipo</Label>
                  <Select value={tipoReserva} onValueChange={(v) => setTipoReserva(v as TipoReserva)}>
                    <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_RESERVA.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Observação</Label>
                <Textarea
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  placeholder="Opcional"
                  className="mt-1 min-h-[60px] bg-card-elevated"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenG(false)}>Cancelar</Button>
              <Button onClick={handleSaveGuardado}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={openB} onOpenChange={setOpenB}>
          <DialogTrigger asChild>
            <Button variant="outline" size="lg" className="h-12 rounded-2xl text-sm font-semibold">
              <Building2 className="mr-1 h-4 w-4" />
              Novo banco
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar banco</DialogTitle>
              <DialogDescription>Crie um banco personalizado.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Nome</Label>
                <Input
                  value={novoBancoNome}
                  onChange={(e) => setNovoBancoNome(e.target.value)}
                  placeholder="Ex.: Carteira"
                  className="mt-1 h-11 bg-card-elevated"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Cor</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNovoBancoCor(c)}
                      className={cn(
                        "h-8 w-8 rounded-full border-2 transition-all",
                        novoBancoCor === c ? "border-foreground scale-110" : "border-transparent",
                      )}
                      style={{ background: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenB(false)}>Cancelar</Button>
              <Button onClick={handleSaveBanco}>Adicionar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <section className="mt-5">
        <h2 className="text-sm font-semibold">Suas reservas</h2>
        {guardado.length === 0 ? (
          <div className="mt-3 flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center animate-fade-in">
            <Wallet className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Registre o que você já guardou para acompanhar sua reserva crescer.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {guardado.map((g) => {
              const banco = bancos.find((b) => b.id === g.bancoId);
              const tipoLabel = TIPOS_RESERVA.find((t) => t.id === g.tipoReserva)?.label;
              return (
                <li key={g.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white text-xs font-bold"
                    style={{ background: banco?.colorHex ?? "var(--cat-outros)" }}
                  >
                    {(banco?.nome ?? "?").slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{banco?.nome ?? "Banco"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {tipoLabel} · atualizado {formatDateBR(g.dataAtualizacao)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p className="num text-sm font-semibold">{formatBRL(g.valor)}</p>
                    <button
                      onClick={() => { deleteGuardado(g.id); toast.success("Removido"); }}
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

      <section className="mt-6">
        <h2 className="text-sm font-semibold">Bancos cadastrados</h2>
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {bancos.map((b) => {
            const valorTotal = porBanco.get(b.id) ?? 0;
            return (
              <li key={b.id} className="flex items-center gap-2 rounded-2xl border border-border bg-card p-3">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: b.colorHex }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{b.nome}</p>
                  <p className="num truncate text-[11px] text-muted-foreground">{formatBRL(valorTotal)}</p>
                </div>
                {b.criadoPeloUsuario && (
                  <button
                    onClick={() => { deleteBanco(b.id); toast.success("Banco removido"); }}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Excluir banco"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </MobileShell>
  );
}
