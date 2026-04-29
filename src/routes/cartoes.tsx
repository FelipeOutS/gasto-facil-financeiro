import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Plus,
  CreditCard,
  Pencil,
  Trash2,
  ShieldCheck,
  CalendarDays,
  Wallet,
  Sparkles,
  MoreHorizontal,
  Receipt,
  Clock,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import {
  addCartao,
  deleteCartao,
  getCartoes,
  getGastos,
  resumoFaturaCartao,
  updateCartao,
  useBootstrap,
  useStore,
  type NovoCartaoInput,
} from "@/lib/store";
import type { Cartao } from "@/lib/types";
import { BANCOS_CARTAO_PADRAO } from "@/lib/types";
import { formatBRL, parseBRLInput } from "@/lib/format";
import { getCardTheme } from "@/lib/card-theme";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cartoes")({
  head: () => ({
    meta: [
      { title: "Cartões — Gasto Fácil" },
      {
        name: "description",
        content:
          "Cadastre seus cartões de crédito e acompanhe limites, fechamento e vencimento da fatura sem dor de cabeça.",
      },
    ],
  }),
  component: CartoesPage,
});

function diasAte(diaAlvo: number, hoje: Date = new Date()): number {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const diaHoje = hoje.getDate();
  const alvoEsteMes = new Date(ano, mes, diaAlvo);
  const alvo = diaAlvo >= diaHoje ? alvoEsteMes : new Date(ano, mes + 1, diaAlvo);
  const ms = alvo.getTime() - new Date(ano, mes, diaHoje).getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function statusFatura(c: Cartao): { label: string; tone: "ok" | "soon" | "due" } {
  if (!c.diaFechamento || !c.diaVencimento)
    return { label: "Sem vencimento definido", tone: "ok" };
  const fecha = diasAte(c.diaFechamento);
  const vence = diasAte(c.diaVencimento);
  if (vence === 0) return { label: "Vence hoje", tone: "due" };
  if (vence <= 3) return { label: `Vence em ${vence} ${vence === 1 ? "dia" : "dias"}`, tone: "due" };
  if (fecha === 0) return { label: "Fecha hoje", tone: "soon" };
  if (fecha <= 5) return { label: `Fecha em ${fecha} ${fecha === 1 ? "dia" : "dias"}`, tone: "soon" };
  return { label: "Fatura aberta", tone: "ok" };
}

function CartoesPage() {
  const ready = useBootstrap();
  const cartoes = useStore(() => getCartoes());
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Cartao | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Cartao | null>(null);

  const resumo = useMemo(() => {
    const limiteTotal = cartoes.reduce((s, c) => s + (c.limiteTotal || 0), 0);
    let usado = 0;
    let proxima: Cartao | null = null;
    let proximaDias = Infinity;
    for (const c of cartoes) {
      const r = resumoFaturaCartao(c.id);
      usado += r.usadoMes;
      if (c.diaVencimento) {
        const d = diasAte(c.diaVencimento);
        if (d < proximaDias) {
          proximaDias = d;
          proxima = c;
        }
      }
    }
    return {
      limiteTotal,
      usado,
      disponivel: Math.max(0, limiteTotal - usado),
      proxima,
      proximaDias: proxima ? proximaDias : null,
    };
  }, [cartoes]);

  function handleOpenNew() {
    setEditing(null);
    setOpenForm(true);
  }
  function handleEdit(c: Cartao) {
    setEditing(c);
    setOpenForm(true);
  }

  if (!ready) {
    return (
      <MobileShell wide>
        <div className="space-y-3 pt-2">
          <Skeleton className="h-10 w-40" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-3xl" />
        </div>
      </MobileShell>
    );
  }

  return (
    <MobileShell wide>
      <header className="pt-2 animate-rise">
        <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Cartões
        </p>
        <h1 className="mt-0.5 text-[26px] font-bold leading-tight tracking-tight">
          Seus cartões 💳
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Limites, faturas e gastos no crédito num lugar só.
        </p>
      </header>

      {/* Resumo */}
      <section className="mt-5 grid grid-cols-2 gap-2.5 stagger lg:grid-cols-4">
        <ResumoCard
          label="Limite total"
          valueNum={resumo.limiteTotal}
          icon={<CreditCard className="h-4 w-4" />}
          tone="brand"
        />
        <ResumoCard
          label="Usado no mês"
          valueNum={resumo.usado}
          icon={<Wallet className="h-4 w-4" />}
          tone="warning"
        />
        <ResumoCard
          label="Disponível"
          valueNum={resumo.disponivel}
          icon={<Sparkles className="h-4 w-4" />}
          tone="success"
        />
        <ResumoCard
          label="Próxima fatura"
          valueText={
            resumo.proxima
              ? `${resumo.proxima.nome} • ${resumo.proximaDias === 0 ? "hoje" : `${resumo.proximaDias}d`}`
              : "—"
          }
          icon={<CalendarDays className="h-4 w-4" />}
          tone="muted"
        />
      </section>

      {/* CTA + lista */}
      <div className="mt-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">
          {cartoes.length === 0 ? "Comece por aqui" : `${cartoes.length} ${cartoes.length === 1 ? "cartão" : "cartões"}`}
        </h2>
        {cartoes.length > 0 && (
          <Button
            size="sm"
            onClick={handleOpenNew}
            className="card-press rounded-full bg-brand-grad text-sm font-semibold shadow-elevated hover:opacity-95"
          >
            <Plus className="mr-1 h-4 w-4" />
            Novo cartão
          </Button>
        )}
      </div>

      {cartoes.length === 0 ? (
        <EmptyState onAdd={handleOpenNew} />
      ) : (
        <section className="mt-3 grid grid-cols-1 gap-4 stagger md:grid-cols-2 xl:grid-cols-3">
          {cartoes.map((c) => (
            <CartaoCard
              key={c.id}
              cartao={c}
              onEdit={() => handleEdit(c)}
              onDelete={() => setConfirmDelete(c)}
            />
          ))}
        </section>
      )}

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground animate-fade-in">
        <ShieldCheck className="h-3.5 w-3.5" />
        Aqui só nome, banco/emissor, limite, fechamento e vencimento. Nada de número, CVV ou senha.
      </p>

      {/* Form modal */}
      <CartaoFormDialog
        open={openForm}
        onOpenChange={setOpenForm}
        editing={editing}
      />

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover cartão?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover{" "}
              <strong>{confirmDelete?.nome}</strong>? Os gastos já lançados
              continuam no seu histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) {
                  deleteCartao(confirmDelete.id);
                  toast.success("Cartão removido.");
                }
                setConfirmDelete(null);
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

/* =============== Sub-components =============== */

function ResumoCard({
  label,
  valueNum,
  valueText,
  icon,
  tone,
}: {
  label: string;
  valueNum?: number;
  valueText?: string;
  icon: React.ReactNode;
  tone: "brand" | "warning" | "success" | "muted";
}) {
  const toneCls =
    tone === "brand"
      ? "bg-brand-soft text-brand-on-soft"
      : tone === "warning"
        ? "bg-warning/15 text-warning"
        : tone === "success"
          ? "bg-success/15 text-success"
          : "bg-card-elevated text-muted-foreground";
  return (
    <div className="hover-lift card-press rounded-2xl border border-border bg-card p-3.5 animate-rise">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span className={cn("grid h-7 w-7 place-items-center rounded-full", toneCls)}>
          {icon}
        </span>
      </div>
      {valueNum !== undefined ? (
        <Money value={valueNum} className="num mt-2 block truncate text-base font-bold" />
      ) : (
        <p className="num mt-2 truncate text-base font-bold">{valueText ?? "—"}</p>
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mt-4 flex flex-col items-center rounded-3xl border border-dashed border-border bg-card p-8 text-center animate-rise">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand-on-soft animate-pop">
        <CreditCard className="h-6 w-6" />
      </div>
      <h3 className="mt-3 text-base font-semibold">Nenhum cartão por aqui ainda</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Cadastre seu primeiro cartão e pare de tentar lembrar fechamento e vencimento de cabeça.
      </p>
      <Button
        onClick={onAdd}
        className="card-press mt-4 rounded-full bg-brand-grad font-semibold shadow-elevated hover:opacity-95"
      >
        <Plus className="mr-1 h-4 w-4" />
        Adicionar primeiro cartão
      </Button>
    </div>
  );
}

function CartaoCard({
  cartao,
  onEdit,
  onDelete,
}: {
  cartao: Cartao;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const r = resumoFaturaCartao(cartao.id);
  const status = statusFatura(cartao);
  const cor = cartao.cor || "#8b5cf6";
  const theme = getCardTheme(cor, cartao.banco);

  return (
    <article
      className="hover-lift card-press group relative overflow-hidden rounded-3xl p-5 text-white shadow-elevated transition-all duration-300"
      style={{ background: theme.background }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent"
      />
      <div className="relative flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-widest text-white/70">
            {cartao.banco || "Cartão"}
          </p>
          <h3 className="mt-0.5 truncate text-lg font-bold">{cartao.nome}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-80 transition-opacity group-hover:opacity-100">
          <button
            onClick={onEdit}
            aria-label="Editar cartão"
            className="grid h-8 w-8 place-items-center rounded-full bg-white/15 backdrop-blur transition-colors hover:bg-white/25"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            aria-label="Remover cartão"
            className="grid h-8 w-8 place-items-center rounded-full bg-white/15 backdrop-blur transition-colors hover:bg-white/25"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative mt-6">
        <div className="flex items-baseline justify-between text-xs text-white/80">
          <span>Usado no mês</span>
          <span className="num">{Math.round(r.pct)}%</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full origin-left rounded-full bg-white/90 animate-fill"
            style={{ width: `${r.pct}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-baseline justify-between text-xs">
          <span className="num text-white">{formatBRL(r.usadoMes)}</span>
          <span className="num text-white/80">de {formatBRL(r.limite)}</span>
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-3 gap-2 text-[11px]">
        <Stat label="Disponível" value={formatBRL(r.disponivel)} />
        <Stat label="Fecha dia" value={cartao.diaFechamento ? `${cartao.diaFechamento}` : "—"} />
        <Stat label="Vence dia" value={cartao.diaVencimento ? `${cartao.diaVencimento}` : "—"} />
      </div>

      <div className="relative mt-4 flex items-center justify-between">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[10px] font-semibold",
            status.tone === "due"
              ? "bg-white/95 text-destructive animate-pulse-soft"
              : status.tone === "soon"
                ? "bg-white/90 text-orange-700"
                : "bg-white/15 text-white",
          )}
        >
          {status.label}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-white/70">
          Crédito
        </span>
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-2 py-1.5 backdrop-blur">
      <p className="text-[9px] uppercase tracking-wide text-white/70">{label}</p>
      <p className="num mt-0.5 truncate text-xs font-semibold">{value}</p>
    </div>
  );
}

/* =============== Form =============== */

const CORES_CARTAO = [
  "#820ad1",
  "#ec7000",
  "#ec0000",
  "#00b1ea",
  "#ff7a00",
  "#3a3a3a",
  "#cc092f",
  "#1c5aa8",
  "#21c25e",
  "#0f9b5e",
  "#8b5cf6",
  "#0ea5e9",
];

function CartaoFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Cartao | null;
}) {
  const [nome, setNome] = useState(editing?.nome ?? "");
  const [banco, setBanco] = useState(editing?.banco ?? "");
  const [limiteStr, setLimiteStr] = useState(
    editing ? editing.limiteTotal.toFixed(2).replace(".", ",") : "",
  );
  const [diaFech, setDiaFech] = useState<number>(editing?.diaFechamento ?? 1);
  const [diaVenc, setDiaVenc] = useState<number>(editing?.diaVencimento ?? 10);
  const [cor, setCor] = useState(editing?.cor ?? CORES_CARTAO[0]);
  const [obs, setObs] = useState(editing?.observacao ?? "");

  // Reset form quando reabrir com outro cartão
  const formKey = editing?.id ?? "new";
  useMemo(() => {
    setNome(editing?.nome ?? "");
    setBanco(editing?.banco ?? "");
    setLimiteStr(editing ? editing.limiteTotal.toFixed(2).replace(".", ",") : "");
    setDiaFech(editing?.diaFechamento ?? 1);
    setDiaVenc(editing?.diaVencimento ?? 10);
    setCor(editing?.cor ?? CORES_CARTAO[0]);
    setObs(editing?.observacao ?? "");
  }, [formKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const limite = parseBRLInput(limiteStr);
  const valid =
    nome.trim().length > 0 &&
    limite >= 0 &&
    diaFech >= 1 &&
    diaFech <= 31 &&
    diaVenc >= 1 &&
    diaVenc <= 31;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error("Confira os campos do cartão.");
      return;
    }
    const payload: NovoCartaoInput = {
      nome: nome.trim(),
      banco: banco.trim(),
      limiteTotal: limite,
      diaFechamento: diaFech,
      diaVencimento: diaVenc,
      cor,
      observacao: obs.trim() || undefined,
    };
    if (editing) {
      updateCartao(editing.id, payload);
      toast.success("Cartão atualizado com sucesso.");
    } else {
      addCartao(payload);
      toast.success("Cartão cadastrado! Agora ficou mais fácil acompanhar sua fatura. 🎉");
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0",
          "sm:max-w-[560px] md:max-w-[760px] lg:max-w-[880px] xl:max-w-[920px]",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-6 text-left">
          <DialogTitle className="text-xl font-bold tracking-tight sm:text-2xl">
            {editing ? "Editar cartão" : "Novo cartão"}
          </DialogTitle>
          <DialogDescription className="text-sm">
            Cadastre só o necessário para controlar sua fatura. Nada de número,
            CVV ou dados sensíveis.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-6 lg:grid-cols-[1fr_minmax(280px,360px)] lg:gap-8">
              {/* COLUNA ESQUERDA — Dados */}
              <div className="space-y-5 animate-rise">
                <section className="space-y-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Dados do cartão
                  </h3>

                  <div>
                    <Label htmlFor="nome" className="text-xs text-muted-foreground">
                      Nome do cartão *
                    </Label>
                    <Input
                      id="nome"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Ex.: Nubank Roxinho"
                      maxLength={40}
                      className="mt-1.5 h-11"
                    />
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Banco / emissor
                    </Label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {BANCOS_CARTAO_PADRAO.map((b) => {
                        const active = banco === b.nome;
                        return (
                          <button
                            key={b.nome}
                            type="button"
                            onClick={() => {
                              setBanco(b.nome);
                              setCor(b.cor);
                            }}
                            className={cn(
                              "card-press rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                              active
                                ? "border-brand bg-brand-soft text-brand-on-soft shadow-card"
                                : "border-border bg-card hover:-translate-y-0.5 hover:bg-card-elevated",
                            )}
                          >
                            {b.nome}
                          </button>
                        );
                      })}
                    </div>
                    <Input
                      value={banco}
                      onChange={(e) => setBanco(e.target.value)}
                      placeholder="Ou digite outro emissor"
                      maxLength={30}
                      className="mt-2.5 h-10"
                    />
                  </div>

                  <div>
                    <Label htmlFor="limite" className="text-xs text-muted-foreground">
                      Limite total (R$)
                    </Label>
                    <Input
                      id="limite"
                      inputMode="decimal"
                      value={limiteStr}
                      onChange={(e) => setLimiteStr(e.target.value)}
                      placeholder="0,00"
                      className="num mt-1.5 h-11"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="fech" className="text-xs text-muted-foreground">
                        Dia de fechamento
                      </Label>
                      <Input
                        id="fech"
                        type="number"
                        min={1}
                        max={31}
                        value={diaFech}
                        onChange={(e) =>
                          setDiaFech(Math.max(1, Math.min(31, Number(e.target.value) || 1)))
                        }
                        className="num mt-1.5 h-11"
                      />
                    </div>
                    <div>
                      <Label htmlFor="venc" className="text-xs text-muted-foreground">
                        Dia de vencimento
                      </Label>
                      <Input
                        id="venc"
                        type="number"
                        min={1}
                        max={31}
                        value={diaVenc}
                        onChange={(e) =>
                          setDiaVenc(Math.max(1, Math.min(31, Number(e.target.value) || 1)))
                        }
                        className="num mt-1.5 h-11"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="obs" className="text-xs text-muted-foreground">
                      Observação (opcional)
                    </Label>
                    <Textarea
                      id="obs"
                      value={obs}
                      onChange={(e) => setObs(e.target.value)}
                      placeholder="Ex.: cartão adicional, uso só em viagens…"
                      maxLength={200}
                      className="mt-1.5 min-h-[72px]"
                    />
                  </div>
                </section>
              </div>

              {/* COLUNA DIREITA — Aparência + Prévia */}
              <div className="space-y-5 animate-rise">
                <section>
                  <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Prévia
                  </h3>
                  <div
                    className="relative mt-2 aspect-[1.586/1] w-full overflow-hidden rounded-2xl p-5 text-white shadow-elevated transition-[background] duration-500 ease-out"
                    style={{ background: getCardTheme(cor, banco).background }}
                  >
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl"
                    />
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent"
                    />
                    <div className="relative flex h-full flex-col justify-between">
                      <div className="flex items-start justify-between">
                        <p className="text-[10px] font-medium uppercase tracking-widest text-white/80">
                          {banco || "Banco"}
                        </p>
                        <div className="grid h-8 w-10 place-items-center rounded-md bg-white/20 backdrop-blur">
                          <CreditCard className="h-4 w-4" />
                        </div>
                      </div>
                      <div>
                        <p className="truncate text-lg font-bold leading-tight">
                          {nome || "Seu cartão"}
                        </p>
                        <div className="mt-2 flex items-end justify-between gap-2">
                          <div>
                            <p className="text-[9px] uppercase tracking-widest text-white/70">
                              Limite
                            </p>
                            <p className="num text-sm font-semibold">
                              {formatBRL(limite || 0)}
                            </p>
                          </div>
                          <span className="text-[10px] uppercase tracking-widest text-white/70">
                            Crédito
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Aparência
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Escolha uma cor para identificar seu cartão.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2.5">
                    {CORES_CARTAO.map((c) => {
                      const active = cor === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCor(c)}
                          aria-label={`Cor ${c}`}
                          aria-pressed={active}
                          className={cn(
                            "relative h-10 w-10 rounded-full border-2 transition-all duration-200",
                            active
                              ? "scale-110 border-foreground shadow-card animate-pop"
                              : "border-transparent hover:scale-105 hover:shadow-card",
                          )}
                          style={{ background: c }}
                        >
                          {active && (
                            <span className="absolute inset-0 grid place-items-center text-white drop-shadow">
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>
          </div>

          {/* Footer sticky */}
          <DialogFooter className="shrink-0 flex-col-reverse gap-2 border-t border-border bg-card/80 px-6 py-4 backdrop-blur sm:flex-row sm:justify-end sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="card-press"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!valid}
              className="card-press bg-brand-grad font-semibold shadow-elevated hover:opacity-95"
            >
              Salvar cartão
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
