import { createFileRoute } from "@tanstack/react-router";
import { EditGastoDialog } from "@/components/EditGastoDialog";
import { GastoForm } from "@/components/GastoForm";
import {
  addGasto,
  deleteGasto,
  deleteGastosDoLote,
  gastosDaFatura,
  lotesImportacaoFatura,
  resumoFaturaPorMes,
  statusEfetivoFatura,
  faturaCorrente,
  getFatura,
  marcarFaturaPaga,
  desmarcarFaturaPaga,
  mesReferenciaFatura,
  mesReferenciaFaturaLabel,
  proximoFechamentoData,
  proximoVencimentoFaturaAberta,
} from "@/lib/store";
import { Link } from "@tanstack/react-router";
import type { StatusFatura } from "@/lib/types";
import { useEffect, useMemo, useState, memo } from "react";
import { Trans, useTranslation } from "react-i18next";
import i18n from "@/i18n";
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
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  CheckCircle2,
  RotateCcw,
  AlertTriangle,
  Lock,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { ImportFaturaDialog } from "@/components/ImportFaturaDialog";
import { CompraInternacionalCard } from "@/components/CompraInternacionalCard";
import { usePlan } from "@/lib/use-plan";
import { UpgradeModal } from "@/components/UpgradeModal";
import {
  deleteCartao,
  getCartoes,
  getCategoriaById,
  getGastos,
  resumoFaturaCartao,
  useBootstrap,
  useStore,
  type NovoGastoInput,
} from "@/lib/store";
import { requireOnline } from "@/lib/use-online-status";
import type { Cartao } from "@/lib/types";
import { formatBRL } from "@/lib/format";
import { getCardTheme } from "@/lib/card-theme";
import { Money } from "@/components/Money";
import { BrandLogo } from "@/components/BrandLogo";
import { preloadAllBankLogos } from "@/lib/logos";
import { CartaoCompactCard, CartaoAddTile } from "@/components/CartaoCompactCard";
import { CartaoForm } from "@/components/CartaoForm";
import { useIsMobile } from "@/hooks/use-mobile";
import { TransactionAvatar } from "@/components/TransactionAvatar";
import { EmptyState as PremiumEmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { toastFromError } from "@/lib/premium-error";
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

export const Route = createFileRoute("/cartoes/")({
  validateSearch: (search: Record<string, unknown>) => ({
    abrir: typeof search.abrir === "string" ? search.abrir : undefined,
    importar: typeof search.importar === "string" ? search.importar : undefined,
  }),
  head: () => ({
    meta: [
      { title: i18n.t("cartoes:meta.title") },
      {
        name: "description",
        content: i18n.t("cartoes:meta.description"),
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




/** Formata o % de uso do limite evitando "0%" quando há gasto. */
function formatPctLimite(usado: number, limite: number, lessThan1Label: string): string {
  if (!limite || limite <= 0) return "—";
  if (usado <= 0) return "0%";
  const pct = (usado / limite) * 100;
  if (pct >= 100) return "100%";
  if (pct >= 1) return `${Math.round(pct)}%`;
  if (pct >= 0.005) return `${pct.toFixed(2).replace(".", ",")}%`;
  return lessThan1Label;
}

/** Normaliza nome do banco/emissor para exibição (ex.: Mercado Pago). */
function formatBanco(banco?: string): string {
  if (!banco) return "";
  const s = banco.trim();
  if (/mercado\s*pago|^mp$/i.test(s)) return "Mercado Pago";
  return s;
}

function CartoesPage() {
  const { t } = useTranslation("cartoes");
  const ready = useBootstrap();
  const cartoes = useStore(() => getCartoes());
  const { abrir, importar } = Route.useSearch();
  const navigate = Route.useNavigate();

  // Preload every bank logo on mount so card swaps are instant — no delay
  // between color change and logo render, no fallback flash.
  useEffect(() => {
    preloadAllBankLogos();
  }, []);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Cartao | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Cartao | null>(null);
  const [openDetail, setOpenDetail] = useState<Cartao | null>(null);
  const [openImport, setOpenImport] = useState(false);
  const [importCartaoId, setImportCartaoId] = useState<string | undefined>(undefined);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { can } = usePlan();

  // Deep-link: ?abrir=<cartaoId> abre automaticamente o detalhe da fatura.
  useEffect(() => {
    if (!ready || !abrir) return;
    const alvo = cartoes.find((c) => c.id === abrir);
    if (alvo) {
      setOpenDetail(alvo);
      // Limpa o param para não reabrir ao voltar.
      navigate({ search: { abrir: undefined, importar: undefined }, replace: true });
    }
  }, [ready, abrir, cartoes, navigate]);

  // Deep-link: ?importar=<cartaoId> abre o diálogo de importação de fatura.
  // Usado pela tela de detalhe mobile (que navega de volta com este param).
  useEffect(() => {
    if (!ready || !importar) return;
    const alvo = cartoes.find((c) => c.id === importar);
    if (!alvo) return;
    if (!can("importar_fatura")) {
      setUpgradeOpen(true);
    } else {
      setImportCartaoId(alvo.id);
      setOpenImport(true);
    }
    navigate({ search: { abrir: undefined, importar: undefined }, replace: true });
  }, [ready, importar, cartoes, navigate, can]);



  const gastos = useStore(() => getGastos());

  // Pré-computa resumo de TODOS os cartões em um único memo. Evita chamar
  // resumoFaturaCartao() repetidamente durante render dos cards e no aside,
  // o que pesava ao tocar/abrir um cartão.
  const resumosPorCartao = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resumoFaturaCartao>>();
    for (const c of cartoes) map.set(c.id, resumoFaturaCartao(c.id));
    return map;
  }, [cartoes, gastos]);

  // Status efetivo da fatura corrente por cartão — usado para filtrar
  // cobranças já pagas dos blocos "Próxima fatura" e "Próximos vencimentos".
  const faturaCorrentePorCartao = useMemo(() => {
    const map = new Map<string, { mes: number; ano: number; status: StatusFatura; pendente: number }>();
    for (const c of cartoes) {
      const ref = faturaCorrente(c);
      const status = statusEfetivoFatura(c, ref.mes, ref.ano);
      const r = resumosPorCartao.get(c.id);
      const pendente = status === "paga" ? 0 : r?.usadoMes ?? 0;
      map.set(c.id, { mes: ref.mes, ano: ref.ano, status, pendente });
    }
    return map;
  }, [cartoes, resumosPorCartao]);

  const resumo = useMemo(() => {
    const limiteTotal = cartoes.reduce((s, c) => s + (c.limiteTotal || 0), 0);
    let usado = 0;
    let proxima: Cartao | null = null;
    let proximaDias = Infinity;
    for (const c of cartoes) {
      const r = resumosPorCartao.get(c.id);
      if (r) usado += r.usadoMes;
      const f = faturaCorrentePorCartao.get(c.id);
      // Só concorre como "próxima fatura" se ainda houver pendência.
      if (c.diaVencimento && f && f.status !== "paga" && f.pendente > 0) {
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
      proximaValor = faturaCorrentePorCartao.get(proxima.id)?.pendente ?? 0;
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
  }, [cartoes, resumosPorCartao, faturaCorrentePorCartao]);

  // Próximos vencimentos — esconde faturas já pagas (sem pendência).
  const proximosVencimentos = useMemo(() => {
    return cartoes
      .filter((c) => {
        if (!c.diaVencimento) return false;
        const f = faturaCorrentePorCartao.get(c.id);
        return !!f && f.status !== "paga" && f.pendente > 0;
      })
      .map((c) => ({ cartao: c, dias: diasAte(c.diaVencimento) }))
      .sort((a, b) => a.dias - b.dias)
      .slice(0, 4);
  }, [cartoes, faturaCorrentePorCartao]);

  // Últimas compras no crédito (top 4 — botão Ver todas leva a /gastos)
  const ultimasComprasAll = useMemo(() => {
    return gastos
      .filter((g) => g.formaPagamento === "credito" && g.cartaoId)
      .sort((a, b) => (a.data < b.data ? 1 : -1));
  }, [gastos]);
  const ultimasCompras = useMemo(() => ultimasComprasAll.slice(0, 4), [ultimasComprasAll]);

  const isMobile = useIsMobile();
  function handleOpenNew() {
    if (isMobile) {
      navigate({ to: "/cartoes/novo" });
      return;
    }
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
          {t("hero.eyebrow")}
        </p>
        <h1 className="mt-0.5 flex items-center gap-2 text-[26px] font-bold leading-tight tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-soft text-brand-on-soft">
            <CreditCard className="h-4 w-4" />
          </span>
          {t("hero.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("hero.subtitle")}
        </p>
      </header>

      {/* ============================================================ */}
      {/* MOBILE (<lg) — cartão protagonista no topo, KPIs compactos    */}
      {/* ============================================================ */}
      {cartoes.length === 0 ? (
        <div className="mt-5 lg:hidden">
          <EmptyState onAdd={handleOpenNew} />
        </div>
      ) : (
        <div className="lg:hidden">
          {/* Carrossel horizontal de cartões */}
          <section className="-mx-4 mt-5 px-4 animate-rise">
            <div
              className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="list"
            >
              {cartoes.map((c) => (
                <div
                  key={c.id}
                  role="listitem"
                  className="snap-center shrink-0 w-[82%] max-w-[340px]"
                >
                  <CartaoCompactCard
                    cartao={c}
                    resumo={resumosPorCartao.get(c.id)}
                    onOpen={() =>
                      isMobile
                        ? navigate({ to: "/cartoes/$id", params: { id: c.id } })
                        : setOpenDetail(c)
                    }
                    onEdit={() => handleEdit(c)}
                    onImport={() => handleOpenImport(c.id)}
                    onDelete={() => setConfirmDelete(c)}
                  />
                </div>
              ))}
              <div
                role="listitem"
                className="snap-center shrink-0 w-[82%] max-w-[340px]"
              >
                <CartaoAddTile onClick={handleOpenNew} />
              </div>
            </div>
            {cartoes.length > 0 && (
              <p className="mt-1 text-center text-[10px] text-muted-foreground">
                {t("list.count", { count: cartoes.length })} · {t("list.tapHint")}
              </p>
            )}
          </section>

          {/* KPIs compactos — peso visual reduzido */}
          <section className="mt-4 grid grid-cols-2 gap-2">
            <CompactKpi
              label={t("summary.limitTotal")}
              value={formatBRL(resumo.limiteTotal)}
              tone="brand"
            />
            <CompactKpi
              label={t("summary.usedMonth")}
              value={formatBRL(resumo.usado)}
              tone="warning"
            />
            <CompactKpi
              label={t("summary.available")}
              value={formatBRL(resumo.disponivel)}
              tone="success"
            />
            <CompactKpi
              label={t("summary.nextInvoice")}
              value={
                resumo.proxima && resumo.proximaData
                  ? `${String(resumo.proximaData.getDate()).padStart(2, "0")}/${String(resumo.proximaData.getMonth() + 1).padStart(2, "0")}`
                  : "—"
              }
              hint={
                resumo.proxima && resumo.proximaDias !== null
                  ? resumo.proximaDias === 0
                    ? t("summary.dueToday")
                    : t("summary.dueDays", { count: resumo.proximaDias })
                  : t("summary.noPending")
              }
              tone="default"
            />
          </section>

          {/* Ações principais — pills */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => handleOpenImport()}
              className="card-press h-11 rounded-full text-sm font-semibold"
            >
              <FileUp className="mr-1 h-4 w-4" />
              {t("list.importInvoice")}
            </Button>
            <Button
              onClick={handleOpenNew}
              className="card-press h-11 rounded-full bg-brand-grad text-sm font-semibold shadow-elevated hover:opacity-95"
            >
              <Plus className="mr-1 h-4 w-4" />
              {t("list.newCard")}
            </Button>
          </div>

          {/* Blocos complementares empilhados */}
          <div className="mt-5 space-y-4">
            <ProximosVencimentos items={proximosVencimentos} />
            <UltimasCompras
              gastos={ultimasCompras}
              cartoes={cartoes}
              hasMore={ultimasComprasAll.length > ultimasCompras.length}
            />
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* DESKTOP (lg+) — mantém o layout atual                         */}
      {/* ============================================================ */}
      <div className="hidden lg:block">
        {/* Resumo */}
        <section className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <ResumoCard
            label={t("summary.limitTotal")}
            valueNum={resumo.limiteTotal}
            icon={<CreditCard className="h-4 w-4" />}
            tone="brand"
          />
          <ResumoCard
            label={t("summary.usedMonth")}
            valueNum={resumo.usado}
            icon={<Wallet className="h-4 w-4" />}
            tone="warning"
          />
          <ResumoCard
            label={t("summary.available")}
            valueNum={resumo.disponivel}
            icon={<Sparkles className="h-4 w-4" />}
            tone="success"
          />
          <ProximaFaturaCard
            cartao={resumo.proxima}
            dias={resumo.proximaDias}
            data={resumo.proximaData}
            valor={resumo.proximaValor}
            temCartoes={cartoes.length > 0}
          />
        </section>

        <div className="mt-6 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              {cartoes.length === 0
                ? t("list.startHere")
                : t("list.count", { count: cartoes.length })}
            </h2>
            {cartoes.length > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("list.tapHint")}
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
                {t("list.importInvoice")}
              </Button>
              <Button
                size="sm"
                onClick={handleOpenNew}
                className="card-press rounded-full bg-brand-grad text-sm font-semibold shadow-elevated hover:opacity-95"
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("list.newCard")}
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
                  resumo={resumosPorCartao.get(c.id)}
                  onOpen={() => setOpenDetail(c)}
                  onEdit={() => handleEdit(c)}
                  onImport={() => handleOpenImport(c.id)}
                  onDelete={() => setConfirmDelete(c)}
                />
              ))}
            </section>
            <aside className="min-w-0 space-y-4">
              <ProximosVencimentos items={proximosVencimentos} />
              <UltimasCompras
                gastos={ultimasCompras}
                cartoes={cartoes}
                hasMore={ultimasComprasAll.length > ultimasCompras.length}
              />
            </aside>
          </div>
        )}
      </div>

      <section className="mt-6">
        <CompraInternacionalCard />
      </section>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground animate-fade-in">
        <ShieldCheck className="h-3.5 w-3.5" />
        {t("security")}
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
            <AlertDialogTitle>{t("remove.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                t={t}
                i18nKey="remove.description"
                values={{ name: confirmDelete?.nome ?? "" }}
                defaults="Tem certeza que deseja remover <1>{{name}}</1>? Os gastos já lançados continuam no seu histórico."
                components={{ 1: <strong /> }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("remove.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!(await requireOnline())) return;
                if (confirmDelete) {
                  deleteCartao(confirmDelete.id);
                  toast.success(t("remove.success"));
                }
                setConfirmDelete(null);
              }}
            >
              {t("remove.confirm")}
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
        featureLabel={t("upgrade.featureLabel")}
        benefit={t("upgrade.benefit")}
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
  const metricTone =
    tone === "brand"
      ? "primary"
      : tone === "warning"
        ? "warning"
        : tone === "success"
          ? "positive"
          : "default";
  return (
    <MetricCard
      label={label}
      icon={icon}
      tone={metricTone}
      value={
        valueNum !== undefined ? (
          <Money value={valueNum} className="num truncate" />
        ) : (
          <span className="num truncate">{valueText ?? "—"}</span>
        )
      }
    />
  );
}

function CompactKpi({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "brand" | "warning" | "success";
}) {
  const dot =
    tone === "brand"
      ? "bg-brand-on-soft"
      : tone === "warning"
        ? "bg-warning"
        : tone === "success"
          ? "bg-success"
          : "bg-muted-foreground/40";
  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
        <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="num mt-1 truncate text-base font-bold leading-tight">{value}</p>
      {hint && (
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation("cartoes");
  return (
    <PremiumEmptyState
      className="mt-4"
      variant="premium"
      icon={<CreditCard className="h-6 w-6" />}
      title={t("empty.title")}
      description={
        <span className="block">
          <span className="block">{t("empty.subtitle")}</span>
          <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" />
            {t("empty.security")}
          </span>
        </span>
      }
      cta={
        <Button
          onClick={onAdd}
          className="card-press min-h-11 rounded-full bg-brand-grad font-semibold shadow-elevated hover:opacity-95"
        >
          <Plus className="mr-1 h-4 w-4" />
          {t("empty.addFirst")}
        </Button>
      }
    />
  );
}


const CartaoCard = memo(function CartaoCard({
  cartao,
  resumo,
  onOpen,
  onEdit,
  onImport,
  onDelete,
}: {
  cartao: Cartao;
  resumo?: { usadoMes: number; limite: number; disponivel: number; pct: number };
  onOpen: () => void;
  onEdit: () => void;
  onImport: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("cartoes");
  // Usa o resumo pré-calculado quando disponível para evitar recomputar
  // ao tocar/abrir o cartão.
  const r = resumo ?? resumoFaturaCartao(cartao.id);
  const cor = cartao.cor || "#8b5cf6";
  const theme = useMemo(() => getCardTheme(cor, cartao.banco), [cor, cartao.banco]);
  const semCompras = r.usadoMes === 0;
  const bancoLabel = formatBanco(cartao.banco);

  // Fatura corrente (mês de referência das compras em aberto)
  const fatRef = useMemo(() => faturaCorrente(cartao), [cartao.id, cartao.diaFechamento]);
  const faturaStatus = useMemo(
    () => statusEfetivoFatura(cartao, fatRef.mes, fatRef.ano),
    [cartao, fatRef.mes, fatRef.ano],
  );
  const faturaResumo = useMemo(
    () => resumoFaturaPorMes(cartao.id, fatRef.mes, fatRef.ano),
    [cartao.id, fatRef.mes, fatRef.ano, r.usadoMes],
  );
  const badge = statusBadgeStyle(faturaStatus, t);

  // Datas formatadas (dd/mm) — vencimento real da fatura aberta.
  const vencDate = useMemo(() => proximoVencimentoFaturaAberta(cartao), [cartao]);
  const fechDate = useMemo(() => proximoFechamentoData(cartao), [cartao]);
  const fmtDM = (d: Date | null) =>
    d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}` : "—";

  async function handleMarcarPaga(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await marcarFaturaPaga(cartao.id, fatRef.mes, fatRef.ano, {
        valorPago: faturaResumo.total,
      });
      toast.success(t("toast.markedPaid"));
    } catch (err) {
      console.error(err);
      toastFromError(err, t("toast.updateError"));
    }
  }

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
      className="hover-lift card-press group relative cursor-pointer overflow-hidden rounded-3xl p-4 text-white shadow-elevated transition-all duration-200 active:scale-[0.99] sm:p-5"
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
        <div className="flex min-w-0 items-center">
          <BrandLogo name={cartao.banco} variant="bank" onDark />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={t("card.moreActions")}
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
              {t("card.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onImport}>
              <FileUp className="mr-2 h-4 w-4" />
              {t("card.import")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("card.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nome do cartão + banco */}
      <div className="relative mt-2.5">
        <h3 className="truncate text-lg font-bold leading-tight sm:text-xl">
          {cartao.nome}
        </h3>
        {bancoLabel && (
          <p className="mt-0.5 truncate text-[11px] font-medium text-white/75">
            {bancoLabel}
          </p>
        )}
      </div>

      {/* Bloco principal — usado / limite */}
      <div className="relative mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-white/70">
              {t("card.usedMonth")}
            </p>
            <p className="num mt-0.5 truncate text-2xl font-bold">
              {formatBRL(r.usadoMes)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-white/70">
              {t("card.limitTotal")}
            </p>
            <p className="num mt-0.5 text-sm font-semibold text-white/90">
              {formatBRL(r.limite)}
            </p>
          </div>
        </div>

        <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full origin-left rounded-full bg-white/95 shadow-[0_0_12px_rgba(255,255,255,0.35)] animate-fill"
            style={{ width: `${Math.max(r.pct, r.usadoMes > 0 ? 1 : 0)}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-white/80">
          <span className="num">{t("card.limitOf", { pct: formatPctLimite(r.usadoMes, r.limite, t("card.lessThan1")) })}</span>
          <span className="num">{t("card.availableValue", { value: formatBRL(r.disponivel) })}</span>
        </div>
      </div>

      {/* Fatura atual */}
      <div className="relative mt-3.5 rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-white/70">
              {t("card.currentInvoice")}
            </p>
            <p className="num mt-0.5 truncate text-base font-bold">
              {formatBRL(faturaResumo.total)}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none",
              faturaStatus === "paga"
                ? "border-white/40 bg-white/95 text-emerald-700"
                : faturaStatus === "vencida"
                  ? "border-white/40 bg-white/95 text-destructive animate-pulse-soft"
                  : faturaStatus === "fechada"
                    ? "border-white/40 bg-white/90 text-orange-700"
                    : "border-white/30 bg-white/15 text-white",
            )}
          >
            {badge.icon}
            {semCompras && faturaStatus === "aberta" ? t("card.noPurchases") : badge.label}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-white/85">
          <div>
            <span className="text-white/60">{t("card.closes")} </span>
            <span className="num font-semibold text-white/95">{fmtDM(fechDate)}</span>
          </div>
          <div className="text-right">
            <span className="text-white/60">{t("card.dueOn")} </span>
            <span className="num font-semibold text-white/95">{fmtDM(vencDate)}</span>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-white/95 px-3 text-[11px] font-semibold text-foreground transition-colors hover:bg-white"
          >
            <Receipt className="h-3 w-3" />
            {t("card.viewInvoice")}
          </button>
          {(faturaStatus === "fechada" || faturaStatus === "vencida") &&
            faturaResumo.total > 0 && (
              <button
                type="button"
                onClick={handleMarcarPaga}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-white/40 bg-white/10 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-white/20"
              >
                <CheckCircle2 className="h-3 w-3" />
                {t("card.markPaid")}
              </button>
            )}
        </div>
      </div>
    </article>
  );
});

/* =============== Próxima fatura (resumo topo) =============== */

function ProximaFaturaCard({
  cartao,
  dias,
  data,
  valor,
  temCartoes,
}: {
  cartao: Cartao | null;
  dias: number | null;
  data: Date | null;
  valor: number;
  temCartoes?: boolean;
}) {
  const { t } = useTranslation("cartoes");
  if (!cartao) {
    if (temCartoes) {
      return (
        <div className="hover-lift card-press rounded-2xl border border-success/30 bg-success/5 p-3.5 animate-rise">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("summary.nextInvoice")}
            </p>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 truncate text-sm font-bold text-success">{t("summary.invoicePaid")}</p>
          <p className="num mt-0.5 text-[11px] text-muted-foreground">
            {t("summary.noPending")}
          </p>
          <p className="num mt-1 text-xs font-semibold text-foreground">{formatBRL(0)}</p>
        </div>
      );
    }
    return (
      <div className="hover-lift card-press rounded-2xl border border-border bg-card p-3.5 animate-rise">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("summary.nextInvoice")}
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
          {t("summary.nextInvoice")}
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
            {dias === 0 ? t("summary.dueToday") : t("summary.dueDays", { count: dias })}
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
  const { t } = useTranslation("cartoes");
  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 animate-rise">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">{t("upcoming.title")}</h3>
            <p className="text-[11px] text-muted-foreground">{t("upcoming.none")}</p>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-border bg-card p-4 animate-rise">
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-brand-on-soft">
          <Clock className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{t("upcoming.title")}</h3>
          <p className="text-[11px] text-muted-foreground">{t("upcoming.watchDates")}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map(({ cartao, dias }) => {
          const theme = getCardTheme(cartao.cor || "#8b5cf6", cartao.banco);
          const urgente = dias <= 1;
          const proximo = dias <= 3;
          const tone = proximo
            ? "text-destructive"
            : dias <= 7
              ? "text-warning"
              : "text-muted-foreground";
          const label =
            dias === 0 ? t("upcoming.today") : dias === 1 ? t("upcoming.tomorrow") : t("upcoming.daysShort", { count: dias });
          return (
            <li
              key={cartao.id}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 transition-colors",
                urgente
                  ? "border border-destructive/30 bg-destructive/10"
                  : "bg-card-elevated",
              )}
            >
              <span
                className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg shadow-card"
                style={{ background: theme.background }}
                aria-hidden
              >
                <BrandLogo
                  name={cartao.banco}
                  variant="bank"
                  onDark
                  className="bank-logo-sm"
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{cartao.nome}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {formatBanco(cartao.banco) || t("upcoming.cardFallback")} · {t("upcoming.dueDay", { day: cartao.diaVencimento })}
                </p>
              </div>
              <span
                className={cn(
                  "num shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  urgente
                    ? "bg-destructive text-destructive-foreground"
                    : tone,
                )}
              >
                {label}
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
  hasMore,
}: {
  gastos: Gasto[];
  cartoes: Cartao[];
  hasMore?: boolean;
}) {
  const { t } = useTranslation("cartoes");
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
          <h3 className="text-sm font-semibold tracking-tight">{t("recent.title")}</h3>
          <p className="text-[11px] text-muted-foreground">
            {gastos.length === 0 ? t("recent.empty") : t("recent.recentMoves")}
          </p>
        </div>
      </div>

      {gastos.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-card-elevated px-3 py-4 text-center">
          <p className="text-xs text-muted-foreground">
            {t("recent.emptyHint")}
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {gastos.map((g) => {
            const c = g.cartaoId ? cartaoMap.get(g.cartaoId) : undefined;
            const dt = new Date(g.data + "T00:00:00");
            const dtStr = `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
            const merchantName = g.estabelecimento || g.descricao || "";
            const cat = g.categoriaId ? getCategoriaById(g.categoriaId) : undefined;
            return (
              <li
                key={g.id}
                className="flex items-center gap-3 rounded-xl bg-card-elevated px-3 py-2"
              >
                <TransactionAvatar
                  estabelecimento={merchantName}
                  categoria={cat}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {g.descricao || g.estabelecimento || t("recent.purchase")}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {c?.nome || t("recent.cardFallback")} · {dtStr}
                    {g.horario ? ` ${t("recent.atTime", { time: g.horario })}` : ""}
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
      {hasMore && gastos.length > 0 && (
        <div className="mt-3 flex justify-end">
          <Link
            to="/gastos"
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-brand-on-soft transition-colors hover:bg-brand-soft"
          >
            {t("recent.seeAll")}
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </section>
  );
}

/* =============== Fatura Sheet (detalhe do cartão) =============== */




type TFn = (key: string, opts?: Record<string, unknown>) => string;

function monthsAbbr(t: TFn): string[] {
  const arr = i18n.t("cartoes:months.abbr", { returnObjects: true }) as unknown;
  return Array.isArray(arr) ? (arr as string[]) : ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
}
function monthsFull(t: TFn): string[] {
  const arr = i18n.t("cartoes:months.full", { returnObjects: true }) as unknown;
  return Array.isArray(arr) ? (arr as string[]) : ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
}

function statusBadgeStyle(status: StatusFatura, t: TFn): { label: string; cls: string; icon: React.ReactNode } {
  switch (status) {
    case "paga":
      return {
        label: t("status.paid"),
        cls: "bg-success/20 text-success border-success/30",
        icon: <CheckCircle2 className="h-3 w-3" />,
      };
    case "vencida":
      return {
        label: t("status.overdue"),
        cls: "bg-destructive/20 text-destructive border-destructive/30",
        icon: <AlertTriangle className="h-3 w-3" />,
      };
    case "fechada":
      return {
        label: t("status.closed"),
        cls: "bg-warning/20 text-warning border-warning/30",
        icon: <Lock className="h-3 w-3" />,
      };
    default:
      return {
        label: t("status.open"),
        cls: "bg-brand-soft text-brand-on-soft border-brand/20",
        icon: <Sparkles className="h-3 w-3" />,
      };
  }
}

export function FaturaSheet({
  cartao,
  gastos: _gastosAll,
  onOpenChange,
  onEdit,
  onImport,
  inline = false,
  onBack,
}: {
  cartao: Cartao | null;
  gastos: Gasto[];
  onOpenChange: (open: boolean) => void;
  onEdit: (c: Cartao) => void;
  onImport: (c: Cartao) => void;
  /** Quando true, renderiza inline (rota dedicada mobile) sem Sheet/modal. */
  inline?: boolean;
  /** Callback do botão Voltar (só usado quando inline). */
  onBack?: () => void;
}) {
  const { t } = useTranslation("cartoes");

  const hoje = new Date();
  const initialRef = cartao
    ? faturaCorrente(cartao, hoje)
    : { mes: hoje.getMonth() + 1, ano: hoje.getFullYear() };
  const [ref, setRef] = useState<{ mes: number; ano: number }>(initialRef);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [editingGasto, setEditingGasto] = useState<Gasto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Gasto | null>(null);
  const [openAdd, setOpenAdd] = useState(false);
  const [confirmLote, setConfirmLote] = useState<string | null>(null);

  // Subscribe to store updates so list refreshes after add/edit/delete/pay
  useStore(() => 0);

  // Reset state ao trocar de cartão / abrir
  useEffect(() => {
    if (cartao) {
      setRef(faturaCorrente(cartao, hoje));
      setSearch("");
      setCatFilter(null);
    }
  }, [cartao?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cartao) {
    if (inline) return null;
    return <Sheet open={false} onOpenChange={onOpenChange} />;
  }

  const compras = gastosDaFatura(cartao.id, ref.mes, ref.ano);
  const resumo = resumoFaturaPorMes(cartao.id, ref.mes, ref.ano);
  const status = statusEfetivoFatura(cartao, ref.mes, ref.ano, hoje);
  const registroFatura = getFatura(cartao.id, ref.mes, ref.ano);
  const theme = getCardTheme(cartao.cor || "#8b5cf6", cartao.banco);
  const badge = statusBadgeStyle(status, t);

  // Categorias presentes na fatura, com totais
  const totaisPorCategoria = (() => {
    const map = new Map<string, { id: string; nome: string; total: number; count: number }>();
    let semCat = 0;
    let semCatCount = 0;
    for (const g of compras) {
      if (g.categoriaId) {
        const cat = getCategoriaById(g.categoriaId);
        const id = g.categoriaId;
        const nome = cat?.nome ?? t("sheet.categoryFallback");
        const cur = map.get(id) ?? { id, nome, total: 0, count: 0 };
        cur.total += g.valor;
        cur.count += 1;
        map.set(id, cur);
      } else {
        semCat += g.valor;
        semCatCount += 1;
      }
    }
    const arr = Array.from(map.values()).sort((a, b) => b.total - a.total);
    if (semCatCount > 0) {
      arr.push({ id: "__sem__", nome: t("sheet.uncategorized"), total: semCat, count: semCatCount });
    }
    return arr;
  })();

  // Aplicar filtros: categoria + busca
  const comprasFiltradas = compras.filter((g) => {
    if (catFilter) {
      if (catFilter === "__sem__") {
        if (g.categoriaId) return false;
      } else if (g.categoriaId !== catFilter) {
        return false;
      }
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack = `${g.descricao ?? ""} ${g.estabelecimento ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Agrupar por data
  const gruposPorData = (() => {
    const map = new Map<string, Gasto[]>();
    for (const g of comprasFiltradas) {
      const arr = map.get(g.data) ?? [];
      arr.push(g);
      map.set(g.data, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
  })();

  // Vencimento em string e dias até vencer.
  // ref.mes/ano = MÊS DE REFERÊNCIA (compras). Vencimento real ocorre no
  // mês seguinte (ou no próprio mês de fechamento se diaVenc>=diaFech).
  const _diaFechRef = cartao.diaFechamento || 1;
  const _diaVencRef = cartao.diaVencimento || 10;
  let proxVencDate = new Date(ref.ano, ref.mes, _diaVencRef);
  const _fechRef = new Date(ref.ano, ref.mes, _diaFechRef);
  if (proxVencDate.getTime() < _fechRef.getTime()) {
    proxVencDate = new Date(ref.ano, ref.mes + 1, _diaVencRef);
  }
  const diasParaVencer = Math.ceil(
    (proxVencDate.getTime() - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  const vencStr = `${String(proxVencDate.getDate()).padStart(2, "0")}/${String(proxVencDate.getMonth() + 1).padStart(2, "0")}`;

  function navMes(delta: number) {
    setRef((r) => {
      const total = r.ano * 12 + (r.mes - 1) + delta;
      return { ano: Math.floor(total / 12), mes: (total % 12) + 1 };
    });
  }

  async function togglePaga() {
    try {
      if (status === "paga") {
        await desmarcarFaturaPaga(cartao!.id, ref.mes, ref.ano);
        toast.success(t("toast.markedOpen"));
      } else {
        await marcarFaturaPaga(cartao!.id, ref.mes, ref.ano, { valorPago: resumo.total });
        toast.success(t("toast.markedPaid"));
      }
    } catch (e) {
      console.error(e);
      toastFromError(e, t("toast.updateError"));
    }
  }

  async function handleAddCompra(data: NovoGastoInput) {
    if (!(await requireOnline())) return;
    const invoiceMonth = `${ref.ano}-${String(ref.mes).padStart(2, "0")}`;
    addGasto({ ...data, formaPagamento: "credito", cartaoId: cartao!.id, invoiceMonth });
    toast.success(t("toast.purchaseAdded"));
    setOpenAdd(false);
  }

  async function handleDeleteCompra() {
    if (!confirmDelete) return;
    if (!(await requireOnline())) return;
    deleteGasto(confirmDelete.id);
    toast.success(t("toast.purchaseRemoved"));
    setConfirmDelete(null);
  }

  const lotes = lotesImportacaoFatura(cartao.id, ref.mes, ref.ano);
  async function handleDeleteLote() {
    if (!confirmLote) return;
    if (!(await requireOnline())) return;
    const n = await deleteGastosDoLote(confirmLote);
    setConfirmLote(null);
    if (n > 0) toast.success(t("toast.batchRemoved", { count: n }));
    else toast.error(t("toast.batchRemoveError"));
  }

  // Aliases — quando inline, evita usar primitives do Radix Dialog (Title/Desc)
  // fora de uma Dialog.Root, o que dispararia erro.
  const HeaderEl: React.ElementType = inline ? "div" : SheetHeader;
  const TitleEl: React.ElementType = inline ? "h2" : SheetTitle;
  const DescEl: React.ElementType = inline ? "p" : SheetDescription;

  // Mostra o nome do cartão apenas se for distinto do banco (apelido real).
  // Evita "Mercado Pago" aparecer 2x (logo + título).
  const bancoNorm = (cartao.banco || "").trim().toLowerCase().replace(/\s+/g, " ");
  const nomeNorm = (cartao.nome || "").trim().toLowerCase().replace(/\s+/g, " ");
  const nomeDistinto = !!cartao.nome && nomeNorm !== bancoNorm && !nomeNorm.includes(bancoNorm) && !bancoNorm.includes(nomeNorm);

  const content = (
    <>
      {/* Hero — visual do cartão (compacto em mobile/inline) */}
      <div
        className={cn(
          "relative overflow-hidden text-white",
          inline ? "p-5" : "p-6",
        )}
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
        {inline && onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar"
            className="relative mb-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/25"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </button>
        )}
        <HeaderEl className={cn("relative flex flex-col gap-1.5 text-left", inline ? "" : "space-y-2")}>
          <div className="flex items-start justify-between gap-3">
            <BrandLogo name={cartao.banco} variant="bank" onDark />
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur",
                "border-white/30 bg-white/15 text-white",
              )}
            >
              {badge.icon}
              {badge.label}
            </span>
          </div>
          {/* Em inline (mobile), só renderiza o título se for um apelido real */}
          {(!inline || nomeDistinto) && (
            <TitleEl
              className={cn(
                "font-bold tracking-tight text-white",
                inline ? "text-lg" : "text-2xl",
              )}
            >
              {inline && nomeDistinto ? cartao.nome : cartao.nome}
            </TitleEl>
          )}
          <DescEl className={cn("text-white/80", inline ? "text-xs" : "text-sm")}>
            {t("sheet.invoiceOf", { label: mesReferenciaFaturaLabel(cartao, ref.mes, ref.ano) })}
            {status === "aberta" ? t("sheet.openSuffix") : ""}.
          </DescEl>
        </HeaderEl>


        {/* Navegação de mês */}
        <div className="relative mt-4 flex items-center justify-between rounded-full border border-white/20 bg-white/10 px-1 py-1 backdrop-blur">
          <button
              type="button"
              onClick={() => navMes(-1)}
              className="grid h-8 w-8 place-items-center rounded-full text-white/90 transition hover:bg-white/15 active:scale-95"
              aria-label={t("sheet.prevMonth")}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold tracking-tight">
              {(() => {
                const r = mesReferenciaFatura(cartao, ref.mes, ref.ano);
                return `${monthsAbbr(t)[r.mes - 1]}/${r.ano}`;
              })()}
            </span>
            <button
              type="button"
              onClick={() => navMes(1)}
              className="grid h-8 w-8 place-items-center rounded-full text-white/90 transition hover:bg-white/15 active:scale-95"
              aria-label={t("sheet.nextMonth")}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Total da fatura */}
          <div className="relative mt-4">
            <p className="text-[10px] font-medium uppercase tracking-widest text-white/70">
              {t("sheet.totalInvoice")}
            </p>
            <p className="num mt-1 text-3xl font-bold tracking-tight">
              {formatBRL(resumo.total)}
            </p>
            {status !== "paga" && status !== "aberta" && diasParaVencer >= 0 && diasParaVencer <= 7 && (
              <p className="mt-1 text-[11px] text-white/80">
                {diasParaVencer === 0
                  ? t("sheet.dueToday")
                  : t("sheet.dueIn", { count: diasParaVencer })}
              </p>
            )}
            {status === "paga" && registroFatura?.dataPagamento && (
              <p className="mt-1 text-[11px] text-white/80">
                {t("sheet.paidOn", { date: (() => {
                  const d = new Date(registroFatura.dataPagamento + "T00:00:00");
                  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
                })() })}
              </p>
            )}
          </div>

          <div className="relative mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <MiniStat label={t("sheet.limit")} value={formatBRL(resumo.limite)} />
            <MiniStat label={t("sheet.available")} value={formatBRL(resumo.disponivel)} />
            <MiniStat label={t("sheet.usage")} value={`${Math.round(resumo.pct)}%`} />
          </div>

          <div className="relative mt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full origin-left rounded-full bg-white/95 shadow-[0_0_12px_rgba(255,255,255,0.35)] animate-fill"
                style={{ width: `${resumo.pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Corpo */}
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-3 gap-2.5">
            <InfoCard label={t("sheet.closing")} value={t("sheet.closingDayValue", { day: cartao.diaFechamento ?? "—" })} />
            <InfoCard label={t("sheet.due")} value={vencStr} />
            <InfoCard
              label={t("sheet.entries")}
              value={String(resumo.qtd)}
              hint={t("sheet.purchase", { count: resumo.qtd })}
            />
          </div>

          {/* Ações principais */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Button
              size="sm"
              className="card-press"
              onClick={() => setOpenAdd(true)}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {t("sheet.addPurchase")}
            </Button>
            <Button
              size="sm"
              variant={status === "paga" ? "secondary" : "default"}
              className="card-press"
              onClick={togglePaga}
              disabled={resumo.qtd === 0 && status !== "paga"}
            >
              {status === "paga" ? (
                <>
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  {t("sheet.reopen")}
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  {t("sheet.markPaidShort")}
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="card-press"
              onClick={() => onImport(cartao)}
            >
              <FileUp className="mr-1.5 h-4 w-4" />
              {t("sheet.import")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="card-press"
              onClick={() => onEdit(cartao)}
            >
              <Pencil className="mr-1.5 h-4 w-4" />
              {t("sheet.edit")}
            </Button>
          </div>

          {/* Busca */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("sheet.searchPlaceholder")}
              className="h-10 pl-9 pr-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition hover:bg-card-elevated"
                aria-label={t("sheet.clearSearch")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Chips de categoria */}
          {totaisPorCategoria.length > 0 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => setCatFilter(null)}
                className={cn(
                  "card-press shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                  catFilter === null
                    ? "border-brand bg-brand-soft text-brand-on-soft"
                    : "border-border bg-card hover:bg-card-elevated",
                )}
              >
                {t("sheet.all")} · {formatBRL(resumo.total)}
              </button>
              {totaisPorCategoria.map((c) => {
                const active = catFilter === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCatFilter(active ? null : c.id)}
                    className={cn(
                      "card-press shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      active
                        ? "border-brand bg-brand-soft text-brand-on-soft"
                        : "border-border bg-card hover:bg-card-elevated",
                    )}
                  >
                    {c.nome} · {formatBRL(c.total)}
                  </button>
                );
              })}
            </div>
          )}

          {lotes.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("sheet.imports")}
              </p>
              <ul className="space-y-1.5">
                {lotes.map((l) => (
                  <li key={l.batchId} className="flex items-center justify-between gap-2 rounded-xl bg-card-elevated px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">
                        {l.origem ?? t("sheet.importOriginDefault")} · {t("sheet.purchases", { count: l.qtd })}
                      </p>
                      <p className="num text-[11px] text-muted-foreground">{t("sheet.totalValue", { value: formatBRL(l.total) })}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setConfirmLote(l.batchId)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      {t("sheet.deleteBatch")}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Lista agrupada por data */}
          <section className="rounded-2xl border border-border bg-card p-2 sm:p-3">
            {comprasFiltradas.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card-elevated px-3 py-8 text-center">
                <Receipt className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-sm font-semibold">
                  {compras.length === 0
                    ? t("sheet.emptyTitle")
                    : t("sheet.emptyFilteredTitle")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {compras.length === 0
                    ? t("sheet.emptyHint")
                    : t("sheet.emptyFilteredHint")}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {gruposPorData.map(([data, items]) => {
                  const dt = new Date(data + "T00:00:00");
                  const totalDia = items.reduce((s, g) => s + g.valor, 0);
                  const dtLabel = t("sheet.dayLabel", { day: String(dt.getDate()).padStart(2, "0"), month: monthsFull(t)[dt.getMonth()] });
                  return (
                    <div key={data}>
                      <div className="mb-1.5 flex items-center justify-between px-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {dtLabel}
                        </p>
                        <p className="num text-[11px] text-muted-foreground">
                          {formatBRL(totalDia)}
                        </p>
                      </div>
                      <ul className="space-y-1.5">
                        {items.map((g) => {
                          const cat = g.categoriaId ? getCategoriaById(g.categoriaId) : undefined;
                          return (
                            <li key={g.id} className="group">
                              <button
                                type="button"
                                onClick={() => setEditingGasto(g)}
                                className="card-press flex w-full items-center gap-3 rounded-xl bg-card-elevated px-3 py-2.5 text-left transition hover:bg-card-elevated/80"
                              >
                                <TransactionAvatar
                                  estabelecimento={g.estabelecimento || g.descricao}
                                  categoria={cat}
                                  size="md"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold">
                                    {g.descricao || g.estabelecimento || t("sheet.purchaseDefault")}
                                  </p>
                                  <p className="truncate text-[11px] text-muted-foreground">
                                    {cat?.nome ?? t("sheet.uncategorized")}
                                    {g.tipoGasto === "parcelado" && g.totalParcelas
                                      ? ` · ${g.parcelaAtual ?? 1}/${g.totalParcelas}`
                                      : ""}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="num shrink-0 text-sm font-semibold">
                                    {formatBRL(g.valor)}
                                  </span>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => e.stopPropagation()}
                                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-card focus:outline-none"
                                        aria-label={t("sheet.purchaseOptions")}
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </span>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                      align="end"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <DropdownMenuItem onClick={() => setEditingGasto(g)}>
                                        <Pencil className="mr-2 h-4 w-4" />
                                        {t("sheet.editItem")}
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() => setConfirmDelete(g)}
                                        className="text-destructive focus:text-destructive"
                                      >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        {t("sheet.deleteItem")}
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Editar gasto */}
        <EditGastoDialog
          gasto={editingGasto}
          open={!!editingGasto}
          onOpenChange={(o) => !o && setEditingGasto(null)}
        />

        {/* Adicionar compra */}
        <Dialog open={openAdd} onOpenChange={setOpenAdd}>
          <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto p-0 sm:max-w-[560px]">
            <DialogHeader className="border-b border-border px-6 pb-4 pt-6 text-left">
              <DialogTitle className="text-xl font-bold tracking-tight">
                {t("sheet.newPurchaseTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("sheet.newPurchaseDesc", { label: mesReferenciaFaturaLabel(cartao, ref.mes, ref.ano) })}
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 py-4">
              <GastoForm
                initial={{
                  formaPagamento: "credito",
                  cartaoId: cartao.id,
                  data: toISODateLocal(new Date()),
                }}
                submitLabel={t("sheet.submitPurchase")}
                onSubmit={handleAddCompra}
              />
            </div>
          </DialogContent>
        </Dialog>

        {/* Confirmar exclusão */}
        <AlertDialog
          open={!!confirmDelete}
          onOpenChange={(o) => !o && setConfirmDelete(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("sheet.deletePurchaseTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("sheet.deletePurchaseDesc")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("sheet.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteCompra}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("sheet.deleteItem")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Confirmar exclusão de lote */}
        <AlertDialog open={!!confirmLote} onOpenChange={(o) => !o && setConfirmLote(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("sheet.deleteBatchTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("sheet.deleteBatchDesc")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("sheet.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteLote}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("sheet.deleteBatchConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </>
  );

  if (inline) {
    return <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">{content}</div>;
  }

  return (
    <Sheet open={!!cartao} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-[640px]"
      >
        {content}
      </SheetContent>
    </Sheet>
  );
}

function toISODateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function CartaoFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Cartao | null;
}) {
  const { t } = useTranslation("cartoes");
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
            {editing ? t("form.editTitle") : t("form.newTitle")}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {t("form.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <CartaoForm
          editing={editing}
          onCancel={() => onOpenChange(false)}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

