import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Target,
  Trophy,
  Sparkles,
  Pencil,
  MoreVertical,
  Minus,
  Image as ImageIcon,
  Check,
  Flame,
  PiggyBank,
  Wallet,
  Flag,
} from "lucide-react";
import {
  MetaCover,
  getMetaCoverKey,
  type MetaCoverKey,
} from "@/components/MetaCover";
import { MobileShell } from "@/components/MobileShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  deleteMeta,
  getBancos,
  getMetas,
  getMetaProgresso,
  getMetaProgressoBreakdown,
  statusMeta,
  useBootstrap,
  useStore,
} from "@/lib/store";
import { requireOnline } from "@/lib/use-online-status";
import type { Meta } from "@/lib/types";
import { formatBRL, formatDateBR } from "@/lib/format";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { MetaFormDialog, type MetaDialogMode } from "@/components/metas/MetaForm";
import { useIsMobile } from "@/hooks/use-mobile";

export const Route = createFileRoute("/metas/")({
  head: () => ({ meta: [{ title: "Metas financeiras — Gasto Inteligente" }] }),
  component: MetasPage,
});

function MetasPage() {
  const { t } = useTranslation("metas");
  const ready = useBootstrap();
  const metas = useStore(() => getMetas());
  const bancos = useStore(() => getBancos());
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const ordenadas = useMemo(() => {
    return [...metas].sort((a, b) => {
      const va = getMetaProgresso(a.id);
      const vb = getMetaProgresso(b.id);
      const pa = a.valorObjetivo > 0 ? va / a.valorObjetivo : 0;
      const pb = b.valorObjetivo > 0 ? vb / b.valorObjetivo : 0;
      return pb - pa;
    });
  }, [metas]);

  const totalAcumulado = useMemo(
    () => metas.reduce((s, m) => s + getMetaProgresso(m.id), 0),
    [metas],
  );

  const [dialog, setDialog] = useState<MetaDialogMode>({ kind: "closed" });
  const [confirmDelete, setConfirmDelete] = useState<Meta | null>(null);

  if (!ready) return <PageSkeleton />;

  function openCreate() {
    if (isMobile) {
      void navigate({ to: "/metas/nova" });
      return;
    }
    setDialog({ kind: "create" });
  }

  function openEdit(m: Meta) {
    if (isMobile) {
      void navigate({ to: "/metas/$id/editar", params: { id: m.id } });
      return;
    }
    setDialog({ kind: "edit", meta: m });
  }

  function openAdd(m: Meta) {
    if (isMobile) {
      void navigate({ to: "/metas/$id/adicionar", params: { id: m.id } });
      return;
    }
    setDialog({ kind: "add", meta: m });
  }

  function openRemove(m: Meta) {
    if (isMobile) {
      void navigate({ to: "/metas/$id/remover", params: { id: m.id } });
      return;
    }
    setDialog({ kind: "remove", meta: m });
  }

  const countLabel = metas.length === 1
    ? t("summary.countOne", { count: metas.length })
    : t("summary.countOther", { count: metas.length });

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label={t("back")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("eyebrow")}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        </div>
      </header>

      <section className="mt-4 rounded-3xl border border-border bg-gradient-to-br from-card to-card-elevated p-5 shadow-elevated animate-rise">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-soft text-brand-on-soft">
            <Target className="h-3.5 w-3.5" />
          </span>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{t("summary.label")}</p>
        </div>
        <Money value={totalAcumulado} className="num mt-2 block text-4xl font-extrabold tracking-tight" />
        <p
          className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: countLabel + t("summary.hint") }}
        />
      </section>

      <Button
        size="lg"
        className="card-press mt-4 h-14 w-full rounded-2xl bg-brand-grad text-base font-semibold shadow-elevated hover:opacity-95"
        onClick={openCreate}
      >
        <Plus className="mr-1 h-5 w-5" />
        {t("newGoal")}
      </Button>

      <section className="mt-5 space-y-3">
        {ordenadas.length === 0 ? (
          <div className="flex flex-col items-center rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-6 text-center animate-rise">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary animate-pop">
              <Target className="h-6 w-6" />
            </div>
            <h3 className="mt-3 text-base font-semibold">{t("onboarding.title")}</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("onboarding.description")}</p>

            <div className="mt-4 flex items-center gap-3 sm:gap-4">
              {[
                t("onboarding.steps.objective"),
                t("onboarding.steps.amount"),
                t("onboarding.steps.progress"),
              ].map((label, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {i + 1}
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Button
                className="card-press min-h-11 rounded-full font-semibold"
                onClick={openCreate}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("empty.cta")}
              </Button>
            </div>
            <p className="mt-2 max-w-xs text-xs text-muted-foreground">{t("empty.helper")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 stagger md:grid-cols-2 xl:grid-cols-3">
            {ordenadas.map((m) => (
              <MetaCard
                key={m.id}
                meta={m}
                onAdd={() => openAdd(m)}
                onRemove={() => openRemove(m)}
                onEdit={() => openEdit(m)}
                onChangeImage={() => openEdit(m)}
                onDelete={() => setConfirmDelete(m)}
              />
            ))}
          </div>
        )}
      </section>

      {!isMobile && (
        <MetaFormDialog
          mode={dialog}
          bancos={bancos}
          onClose={() => setDialog({ kind: "closed" })}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const tpl = t("delete.description", { name: "\u0000NAME\u0000" });
                const parts = tpl.split("\u0000NAME\u0000");
                return (
                  <>
                    {parts[0]?.replace(/<\/?strong>/g, "")}
                    <strong>{confirmDelete?.nome ?? ""}</strong>
                    {parts[1]?.replace(/<\/?strong>/g, "")}
                  </>
                );
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("delete.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!(await requireOnline())) return;
                if (confirmDelete) {
                  deleteMeta(confirmDelete.id);
                  toast.success(t("delete.toast"));
                }
                setConfirmDelete(null);
              }}
            >
              {t("delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

function MetaCard({
  meta,
  onAdd,
  onRemove,
  onEdit,
  onChangeImage,
  onDelete,
}: {
  meta: Meta;
  onAdd: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onChangeImage: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("metas");
  const breakdown = getMetaProgressoBreakdown(meta.id);
  const progresso = breakdown.total;
  const status: ReturnType<typeof statusMeta> =
    meta.valorObjetivo > 0 && progresso / meta.valorObjetivo >= 1
      ? "concluida"
      : meta.valorObjetivo > 0 && progresso / meta.valorObjetivo >= 0.8
        ? "quase"
        : progresso > 0
          ? "em_andamento"
          : "nao_iniciada";
  const pct = meta.valorObjetivo > 0 ? Math.min(100, (progresso / meta.valorObjetivo) * 100) : 0;
  const restante = breakdown.restante;
  const isDone = status === "concluida";
  const isAlmostDone = pct >= 80 && !isDone;

  const coverKey = (meta.imagemKey as MetaCoverKey | undefined) ?? getMetaCoverKey(meta.nome, meta.descricao);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-3xl border border-border bg-card transition-all duration-300",
        "hover:-translate-y-0.5 hover:shadow-elevated",
        isDone && "ring-2",
      )}
      style={{
        boxShadow: isDone ? `0 0 0 1px ${meta.colorHex} inset, 0 12px 30px -16px ${meta.colorHex}` : undefined,
      }}
    >
      <div className="relative h-56 w-full overflow-hidden sm:h-60">
        <div className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-[1.05]">
          <MetaCover coverKey={coverKey} alt={meta.nome} className="h-full w-full" />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/5" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/55 to-transparent" />

        <div className="absolute left-3 right-3 top-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {isDone && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-success-foreground shadow-md animate-pop">
                <Trophy className="h-3 w-3" /> {t("card.doneBadge")}
              </span>
            )}
            {isAlmostDone && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-md">
                <Flame className="h-3 w-3" /> {t("card.almostBadge")}
              </span>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
                aria-label={t("card.moreActions")}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                {t("card.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onChangeImage}>
                <ImageIcon className="mr-2 h-4 w-4" />
                {t("card.changeImage")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onAdd}>
                <Plus className="mr-2 h-4 w-4" />
                {t("card.updateValue")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onRemove} disabled={progresso <= 0}>
                <Minus className="mr-2 h-4 w-4" />
                {t("card.removeValue")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                {t("card.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="absolute inset-x-0 bottom-0 px-5 pb-4">
          <p className="line-clamp-1 text-lg font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]">
            {meta.nome}
          </p>
          <p className="line-clamp-1 text-[12px] text-white/85 drop-shadow">
            {t(`status.${status}`)}
            {meta.prazo ? t("card.untilDate", { date: formatDateBR(meta.prazo) }) : ""}
          </p>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("card.progressLabel")}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Money
              value={progresso}
              className="num text-3xl sm:text-4xl font-extrabold tracking-tight leading-none"
            />
            <span className="num text-sm text-muted-foreground whitespace-nowrap">
              {t("card.of")} <span className="font-semibold text-foreground/80">{formatBRL(meta.valorObjetivo)}</span>
            </span>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-elevated">
              <div
                className="h-full rounded-full origin-left animate-fill"
                style={{
                  width: `${pct}%`,
                  background: isDone
                    ? `linear-gradient(90deg, ${meta.colorHex}, color-mix(in oklab, ${meta.colorHex} 60%, white))`
                    : meta.colorHex,
                  transition: "width 600ms cubic-bezier(0.22, 0.61, 0.36, 1)",
                }}
              />
            </div>
            <span
              className="num shrink-0 text-xs font-semibold tabular-nums"
              style={{ color: meta.colorHex }}
            >
              {pct.toFixed(0)}%
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card-elevated/50 px-3 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-500">
                <PiggyBank className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs text-muted-foreground truncate">{t("card.savedInReserves")}</span>
            </div>
            <span className="num text-sm font-semibold tabular-nums">{formatBRL(breakdown.guardado)}</span>
          </div>

          {breakdown.direto > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card-elevated/50 px-3 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-500/15 text-sky-500">
                  <Wallet className="h-3.5 w-3.5" />
                </span>
                <span className="text-xs text-muted-foreground truncate">{t("card.addedDirect")}</span>
              </div>
              <span className="num text-sm font-semibold tabular-nums">{formatBRL(breakdown.direto)}</span>
            </div>
          )}

          <div
            className="flex items-center justify-between rounded-xl border px-3 py-2.5"
            style={{
              borderColor: isDone ? `color-mix(in oklab, ${meta.colorHex} 40%, transparent)` : undefined,
              background: `color-mix(in oklab, ${meta.colorHex} 8%, transparent)`,
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                style={{
                  background: `color-mix(in oklab, ${meta.colorHex} 18%, transparent)`,
                  color: meta.colorHex,
                }}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : <Flag className="h-3.5 w-3.5" />}
              </span>
              <span className="text-xs font-semibold text-foreground truncate">
                {isDone ? t("card.goalDone") : t("card.remaining")}
              </span>
            </div>
            <span className="num text-sm font-bold tabular-nums" style={{ color: meta.colorHex }}>
              {formatBRL(restante)}
            </span>
          </div>
        </div>

        {isDone ? (
          <div className="flex items-center justify-center gap-1.5 rounded-xl bg-success/10 px-3 py-2.5 text-xs font-semibold text-success animate-pop">
            <Sparkles className="h-3.5 w-3.5" />
            {t("card.doneCelebrate")}
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="card-press h-10 w-full rounded-xl font-semibold"
            onClick={onAdd}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("card.updateButton")}
          </Button>
        )}
      </div>
    </div>
  );
}
