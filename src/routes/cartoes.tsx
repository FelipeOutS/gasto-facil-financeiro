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
  FileUp,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { ImportFaturaDialog } from "@/components/ImportFaturaDialog";
import { usePlan } from "@/lib/use-plan";
import { UpgradeModal } from "@/components/UpgradeModal";
import {
  addCartao,
  deleteCartao,
  getCartoes,
  getCategoriaById,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Gasto } from "@/lib/types";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/cartoes")({
  head: () => ({
    meta: [
      { title: "Cartões — Gasto Inteligente" },
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
  const [openDetail, setOpenDetail] = useState<Cartao | null>(null);
  const [openImport, setOpenImport] = useState(false);
  const [importCartaoId, setImportCartaoId] = useState<string | undefined>(undefined);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { can } = usePlan();

  const gastos = useStore(() => getGastos());

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
    let proximaData: Date | null = null;
    let proximaValor = 0;
    if (proxima && proxima.diaVencimento) {
      const hoje = new Date();
      const alvoEsteMes = new Date(hoje.getFullYear(), hoje.getMonth(), proxima.diaVencimento);
      proximaData =
        proxima.diaVencimento >= hoje.getDate()
          ? alvoEsteMes
          : new Date(hoje.getFullYear(), hoje.getMonth() + 1, proxima.diaVencimento);
      proximaValor = resumoFaturaCartao(proxima.id).usadoMes;
    }
    return {
      limiteTotal,
      usado,
      disponivel: Math.max(0, limiteTotal - usado),
      proxima,
      proximaDias: proxima ? proximaDias : null,
      proximaData,
      proximaValor,
    };
  }, [cartoes, gastos]);

  // Próximos vencimentos (todos cartões com dia definido)
  const proximosVencimentos = useMemo(() => {
    return cartoes
      .filter((c) => !!c.diaVencimento)
      .map((c) => ({ cartao: c, dias: diasAte(c.diaVencimento) }))
      .sort((a, b) => a.dias - b.dias)
      .slice(0, 4);
  }, [cartoes]);

  // Últimas compras no crédito (todas, top 5)
  const ultimasCompras = useMemo(() => {
    return gastos
      .filter((g) => g.formaPagamento === "credito" && g.cartaoId)
      .sort((a, b) => (a.data < b.data ? 1 : -1))
      .slice(0, 5);
  }, [gastos]);

  function handleOpenNew() {
    setEditing(null);
    setOpenForm(true);
  }
  function handleEdit(c: Cartao) {
    setEditing(c);
    setOpenForm(true);
  }

  function handleOpenImport(cartaoId?: string) {
    if (!can("importar_fatura")) {
      setUpgradeOpen(true);
      return;
    }
    setImportCartaoId(cartaoId);
    setOpenImport(true);
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
      <section className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
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
        <ProximaFaturaCard
          cartao={resumo.proxima}
          dias={resumo.proximaDias}
          data={resumo.proximaData}
          valor={resumo.proximaValor}
        />
      </section>

      {/* CTA + lista */}
      <div className="mt-6 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            {cartoes.length === 0
              ? "Comece por aqui"
              : `${cartoes.length} ${cartoes.length === 1 ? "cartão" : "cartões"}`}
          </h2>
          {cartoes.length > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Toque em um cartão para ver detalhes da fatura.
            </p>
          )}
        </div>
        {cartoes.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleOpenImport()}
              className="card-press rounded-full text-sm font-semibold"
            >
              <FileUp className="mr-1 h-4 w-4" />
              Importar fatura
            </Button>
            <Button
              size="sm"
              onClick={handleOpenNew}
              className="card-press rounded-full bg-brand-grad text-sm font-semibold shadow-elevated hover:opacity-95"
            >
              <Plus className="mr-1 h-4 w-4" />
              Novo cartão
            </Button>
          </div>
        )}
      </div>

      {cartoes.length === 0 ? (
        <EmptyState onAdd={handleOpenNew} />
      ) : (
          <div className="mt-4 grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)] xl:gap-6">
          <section
            className={cn(
                "grid min-w-0 grid-cols-1 gap-5",
              cartoes.length > 1 && "xl:grid-cols-2",
            )}
          >
            {cartoes.map((c) => (
              <CartaoCard
                key={c.id}
                cartao={c}
                onOpen={() => setOpenDetail(c)}
                onEdit={() => handleEdit(c)}
                onImport={() => handleOpenImport(c.id)}
                onDelete={() => setConfirmDelete(c)}
              />
            ))}
          </section>
          <aside className="min-w-0 space-y-4">
            <ProximosVencimentos items={proximosVencimentos} />
            <UltimasCompras gastos={ultimasCompras} cartoes={cartoes} />
          </aside>
        </div>
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

      <FaturaSheet
        cartao={openDetail}
        gastos={gastos}
        onOpenChange={(o) => !o && setOpenDetail(null)}
        onEdit={(c) => {
          setOpenDetail(null);
          handleEdit(c);
        }}
        onImport={(c) => {
          setOpenDetail(null);
          handleOpenImport(c.id);
        }}
      />

      <ImportFaturaDialog
        open={openImport}
        onOpenChange={setOpenImport}
        cartaoIdInicial={importCartaoId}
      />
      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        feature="importar_fatura"
        featureLabel="Importar fatura de cartão"
        benefit="Importe a fatura em PDF/imagem e categorize tudo automaticamente."
      />
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
  onOpen,
  onEdit,
  onImport,
  onDelete,
}: {
  cartao: Cartao;
  onOpen: () => void;
  onEdit: () => void;
  onImport: () => void;
  onDelete: () => void;
}) {
  const r = resumoFaturaCartao(cartao.id);
  const status = statusFatura(cartao);
  const cor = cartao.cor || "#8b5cf6";
  const theme = getCardTheme(cor, cartao.banco);
  const semCompras = r.usadoMes === 0;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="hover-lift card-press group relative cursor-pointer overflow-hidden rounded-3xl p-6 text-white shadow-elevated transition-all duration-300 sm:p-7"
      style={{ background: theme.background }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10 blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent"
      />

      {/* Header — banco + ações */}
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid h-7 w-9 shrink-0 place-items-center rounded-md bg-white/20 backdrop-blur">
            <CreditCard className="h-3.5 w-3.5" />
          </div>
          <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-white/80">
            {cartao.banco || "Cartão"}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Mais ações"
              onClick={(e) => e.stopPropagation()}
              className="grid h-8 w-8 place-items-center rounded-full bg-white/15 backdrop-blur transition-colors hover:bg-white/25"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-[160px]"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Editar cartão
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onImport}>
              <FileUp className="mr-2 h-4 w-4" />
              Importar fatura
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remover cartão
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nome do cartão */}
      <h3 className="relative mt-3 truncate text-xl font-bold leading-tight">
        {cartao.nome}
      </h3>

      {/* Bloco principal — usado / limite */}
      <div className="relative mt-5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-white/70">
              Usado no mês
            </p>
            <p className="num mt-0.5 truncate text-2xl font-bold">
              {formatBRL(r.usadoMes)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-white/70">
              Limite
            </p>
            <p className="num mt-0.5 text-sm font-semibold text-white/90">
              {formatBRL(r.limite)}
            </p>
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full origin-left rounded-full bg-white/95 shadow-[0_0_12px_rgba(255,255,255,0.35)] animate-fill"
            style={{ width: `${r.pct}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-white/80">
          <span className="num">{Math.round(r.pct)}% do limite</span>
          <span className="num">{formatBRL(r.disponivel)} disponível</span>
        </div>
      </div>

      {/* Footer — fechamento, vencimento, status */}
      <div className="relative mt-5 flex flex-wrap items-center gap-2 border-t border-white/15 pt-3">
        <div className="flex items-center gap-1.5 text-[11px] text-white/85">
          <CalendarDays className="h-3.5 w-3.5 opacity-80" />
          <span>
            Fecha <strong className="num font-semibold">{cartao.diaFechamento || "—"}</strong>
            {" · "}
            Vence <strong className="num font-semibold">{cartao.diaVencimento || "—"}</strong>
          </span>
        </div>
        <span
          className={cn(
            "ml-auto rounded-full px-2.5 py-1 text-[10px] font-semibold",
            status.tone === "due"
              ? "bg-white/95 text-destructive animate-pulse-soft"
              : status.tone === "soon"
                ? "bg-white/90 text-orange-700"
                : "bg-white/15 text-white",
          )}
        >
          {semCompras && status.tone === "ok" ? "Sem compras ainda" : status.label}
        </span>
      </div>

      <span className="pointer-events-none absolute bottom-3 right-5 text-[9px] uppercase tracking-[0.2em] text-white/55">
        Crédito
      </span>
    </article>
  );
}

/* =============== Próxima fatura (resumo topo) =============== */

function ProximaFaturaCard({
  cartao,
  dias,
  data,
  valor,
}: {
  cartao: Cartao | null;
  dias: number | null;
  data: Date | null;
  valor: number;
}) {
  if (!cartao) {
    return (
      <div className="hover-lift card-press rounded-2xl border border-border bg-card p-3.5 animate-rise">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Próxima fatura
          </p>
          <span className="grid h-7 w-7 place-items-center rounded-full bg-card-elevated text-muted-foreground">
            <CalendarDays className="h-4 w-4" />
          </span>
        </div>
        <p className="num mt-2 truncate text-base font-bold text-muted-foreground">—</p>
      </div>
    );
  }
  const dataStr = data
    ? `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}`
    : "";
  const tone =
    dias !== null && dias <= 3
      ? "bg-destructive/15 text-destructive"
      : dias !== null && dias <= 7
        ? "bg-warning/15 text-warning"
        : "bg-brand-soft text-brand-on-soft";

  return (
    <div className="hover-lift card-press rounded-2xl border border-border bg-card p-3.5 animate-rise">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Próxima fatura
        </p>
        <span className={cn("grid h-7 w-7 place-items-center rounded-full", tone)}>
          <CalendarDays className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 truncate text-sm font-bold">{cartao.nome}</p>
      <p className="num mt-0.5 text-[11px] text-muted-foreground">
        {dataStr}
        {dias !== null && (
          <>
            {" · "}
            {dias === 0 ? "vence hoje" : `${dias} ${dias === 1 ? "dia" : "dias"}`}
          </>
        )}
      </p>
      {valor > 0 && (
        <p className="num mt-1 text-xs font-semibold text-foreground">
          {formatBRL(valor)}
        </p>
      )}
    </div>
  );
}

/* =============== Aside — próximos vencimentos =============== */

function ProximosVencimentos({
  items,
}: {
  items: Array<{ cartao: Cartao; dias: number }>;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 animate-rise">
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-brand-on-soft">
          <Clock className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Próximos vencimentos</h3>
          <p className="text-[11px] text-muted-foreground">Fique de olho nas datas</p>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map(({ cartao, dias }) => {
          const theme = getCardTheme(cartao.cor || "#8b5cf6", cartao.banco);
          const tone =
            dias <= 3 ? "text-destructive" : dias <= 7 ? "text-warning" : "text-muted-foreground";
          return (
            <li
              key={cartao.id}
              className="flex items-center gap-3 rounded-xl bg-card-elevated px-3 py-2"
            >
              <span
                className="h-8 w-8 shrink-0 rounded-lg shadow-card"
                style={{ background: theme.background }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{cartao.nome}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {cartao.banco || "Cartão"} · vence dia {cartao.diaVencimento}
                </p>
              </div>
              <span className={cn("num shrink-0 text-xs font-semibold", tone)}>
                {dias === 0 ? "hoje" : `${dias}d`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* =============== Aside — últimas compras no crédito =============== */

function UltimasCompras({
  gastos,
  cartoes,
}: {
  gastos: Gasto[];
  cartoes: Cartao[];
}) {
  const cartaoMap = useMemo(() => {
    const m = new Map<string, Cartao>();
    for (const c of cartoes) m.set(c.id, c);
    return m;
  }, [cartoes]);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 animate-rise">
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-brand-on-soft">
          <Receipt className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Últimas compras no crédito</h3>
          <p className="text-[11px] text-muted-foreground">
            {gastos.length === 0 ? "Nada por aqui ainda" : "Movimentações recentes"}
          </p>
        </div>
      </div>

      {gastos.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-card-elevated px-3 py-4 text-center">
          <p className="text-xs text-muted-foreground">
            Quando você lançar uma compra no crédito vinculada a um cartão, ela aparece aqui.
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {gastos.map((g) => {
            const c = g.cartaoId ? cartaoMap.get(g.cartaoId) : undefined;
            const theme = c ? getCardTheme(c.cor || "#8b5cf6", c.banco) : null;
            const dt = new Date(g.data + "T00:00:00");
            const dtStr = `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
            return (
              <li
                key={g.id}
                className="flex items-center gap-3 rounded-xl bg-card-elevated px-3 py-2"
              >
                <span
                  className="h-8 w-8 shrink-0 rounded-lg shadow-card"
                  style={theme ? { background: theme.background } : undefined}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {g.descricao || g.estabelecimento || "Compra"}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {c?.nome || "Cartão"} · {dtStr}
                    {g.horario ? ` às ${g.horario}` : ""}
                    {g.tipoGasto === "parcelado" && g.totalParcelas
                      ? ` · ${g.parcelaAtual ?? 1}/${g.totalParcelas}`
                      : ""}
                  </p>
                </div>
                <span className="num shrink-0 text-xs font-semibold">
                  {formatBRL(g.valor)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* =============== Fatura Sheet (detalhe do cartão) =============== */

function FaturaSheet({
  cartao,
  gastos,
  onOpenChange,
  onEdit,
  onImport,
}: {
  cartao: Cartao | null;
  gastos: Gasto[];
  onOpenChange: (open: boolean) => void;
  onEdit: (c: Cartao) => void;
  onImport: (c: Cartao) => void;
}) {
  // Compras vinculadas (memoizadas, ordenadas por data desc)
  const compras = useMemo(() => {
    if (!cartao) return [];
    return gastos
      .filter((g) => g.cartaoId === cartao.id && g.formaPagamento === "credito")
      .sort((a, b) => (a.data < b.data ? 1 : -1));
  }, [cartao, gastos]);

  if (!cartao) {
    return <Sheet open={false} onOpenChange={onOpenChange} />;
  }

  const r = resumoFaturaCartao(cartao.id);
  const status = statusFatura(cartao);
  const theme = getCardTheme(cartao.cor || "#8b5cf6", cartao.banco);
  const semCompras = compras.length === 0;

  // Compras do mês atual = "Fatura atual" (simplificação coerente com store)
  const hoje = new Date();
  const mes = hoje.getMonth() + 1;
  const ano = hoje.getFullYear();
  const comprasFaturaAtual = compras.filter((g) => g.mes === mes && g.ano === ano);
  const totalFatura = comprasFaturaAtual.reduce((s, g) => s + g.valor, 0);

  // Próxima data de vencimento
  const alvoEsteMes = new Date(ano, hoje.getMonth(), cartao.diaVencimento);
  const proxVenc =
    cartao.diaVencimento >= hoje.getDate()
      ? alvoEsteMes
      : new Date(ano, hoje.getMonth() + 1, cartao.diaVencimento);
  const vencStr = `${String(proxVenc.getDate()).padStart(2, "0")}/${String(proxVenc.getMonth() + 1).padStart(2, "0")}`;

  return (
    <Sheet open={!!cartao} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-[560px]"
      >
        {/* Hero — visual do cartão */}
        <div
          className="relative overflow-hidden p-6 text-white"
          style={{ background: theme.background }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10 blur-2xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent"
          />
          <SheetHeader className="relative space-y-1 text-left">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/80">
              {cartao.banco || "Cartão"}
            </p>
            <SheetTitle className="text-2xl font-bold tracking-tight text-white">
              {cartao.nome}
            </SheetTitle>
            <SheetDescription className="text-white/80">
              Sua fatura atual e últimas compras no crédito.
            </SheetDescription>
          </SheetHeader>

          <div className="relative mt-5 grid grid-cols-3 gap-2">
            <MiniStat label="Limite" value={formatBRL(r.limite)} />
            <MiniStat label="Usado" value={formatBRL(r.usadoMes)} />
            <MiniStat label="Disponível" value={formatBRL(r.disponivel)} />
          </div>

          <div className="relative mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full origin-left rounded-full bg-white/95 shadow-[0_0_12px_rgba(255,255,255,0.35)] animate-fill"
                style={{ width: `${r.pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-white/80">
              {Math.round(r.pct)}% do limite usado
            </p>
          </div>
        </div>

        {/* Corpo */}
        <div className="space-y-5 p-5">
          {/* Cards informativos */}
          <div className="grid grid-cols-2 gap-3">
            <InfoCard
              label="Próximo vencimento"
              value={vencStr}
              hint={`Vence dia ${cartao.diaVencimento}`}
            />
            <InfoCard
              label="Fechamento"
              value={`Dia ${cartao.diaFechamento}`}
              hint={status.label}
            />
          </div>

          {/* Fatura atual */}
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">Sua fatura atual</h3>
                <p className="text-[11px] text-muted-foreground">
                  {comprasFaturaAtual.length === 0
                    ? "Nenhuma compra neste período."
                    : `${comprasFaturaAtual.length} ${comprasFaturaAtual.length === 1 ? "compra" : "compras"} no período`}
                </p>
              </div>
              <p className="num text-base font-bold">{formatBRL(totalFatura)}</p>
            </div>
          </section>

          {/* Lista de compras */}
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-tight">
                Compras no cartão
              </h3>
              {!semCompras && (
                <span className="text-[11px] text-muted-foreground">
                  {compras.length} {compras.length === 1 ? "lançamento" : "lançamentos"}
                </span>
              )}
            </div>

            {semCompras ? (
              <div className="mt-3 rounded-xl border border-dashed border-border bg-card-elevated px-3 py-6 text-center">
                <Receipt className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-sm font-semibold">
                  Nenhuma compra no crédito por aqui ainda
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lançou uma compra no crédito? Ela aparece aqui.
                </p>
              </div>
            ) : (
              <ul className="mt-3 space-y-2">
                {compras.slice(0, 12).map((g) => {
                  const cat = g.categoriaId ? getCategoriaById(g.categoriaId) : undefined;
                  const dt = new Date(g.data + "T00:00:00");
                  const dtStr = `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
                  return (
                    <li
                      key={g.id}
                      className="flex items-center gap-3 rounded-xl bg-card-elevated px-3 py-2.5"
                    >
                      <span
                        className="h-9 w-9 shrink-0 rounded-lg shadow-card"
                        style={{ background: theme.background }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {g.descricao || g.estabelecimento || "Compra"}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {cat?.nome ? `${cat.nome} · ` : ""}
                          {dtStr}
                          {g.tipoGasto === "parcelado" && g.totalParcelas
                            ? ` · parcela ${g.parcelaAtual ?? 1}/${g.totalParcelas}`
                            : ""}
                        </p>
                      </div>
                      <span className="num shrink-0 text-sm font-semibold">
                        {formatBRL(g.valor)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Ações */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="card-press flex-1"
              onClick={() => onImport(cartao)}
            >
              <FileUp className="mr-2 h-4 w-4" />
              Importar fatura
            </Button>
            <Button
              variant="outline"
              className="card-press flex-1"
              onClick={() => onEdit(cartao)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Editar cartão
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/15 px-3 py-2 backdrop-blur">
      <p className="text-[9px] uppercase tracking-widest text-white/70">{label}</p>
      <p className="num mt-0.5 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function InfoCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="num mt-1 text-base font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
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
