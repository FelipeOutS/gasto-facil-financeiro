import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Wallet,
  Building2,
  MoreVertical,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import guardadoHero from "@/assets/guardado-hero.png";
import { MobileShell } from "@/components/MobileShell";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  addBanco,
  addGuardado,
  deleteBanco,
  deleteGuardado,
  findReservaSimilar,
  getBancos,
  getGuardado,
  getMetas,
  updateGuardado,
  useBootstrap,
  useStore,
} from "@/lib/store";
import { TIPOS_RESERVA, type TipoReserva, type Guardado } from "@/lib/types";
import { formatBRL, formatDateBR, parseBRLInput } from "@/lib/format";
import { Money } from "@/components/Money";
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
} from "@/components/ui/dialog";
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

const COLOR_OPTIONS = [
  "#820ad1", "#00b1ea", "#ec7000", "#cc092f", "#ec0000", "#fae128",
  "#1c5aa8", "#ff7a00", "#3a3a3a", "#21c25e", "#048b3a", "#0f2a4a",
];

export const Route = createFileRoute("/guardado")({
  head: () => ({ meta: [{ title: i18n.t("guardado:meta.title", { lng: i18n.language }) }] }),
  component: GuardadoPage,
});

type DialogMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; reserva: Guardado };

function tipoLabel(tipo: TipoReserva, t: (k: string) => string) {
  return t("tipo." + tipo) || TIPOS_RESERVA.find((x) => x.id === tipo)?.label || tipo;
}

function GuardadoPage() {
  const { t } = useTranslation("guardado");
  const ready = useBootstrap();
  const bancos = useStore(() => getBancos());
  const guardado = useStore(() => getGuardado());
  const metas = useStore(() => getMetas());

  const total = useMemo(() => guardado.reduce((s, g) => s + g.valor, 0), [guardado]);
  const porBanco = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of guardado) map.set(g.bancoId, (map.get(g.bancoId) ?? 0) + g.valor);
    return map;
  }, [guardado]);

  const [dialog, setDialog] = useState<DialogMode>({ kind: "closed" });
  const [confirmDelete, setConfirmDelete] = useState<Guardado | null>(null);

  // Add banco dialog
  const [openB, setOpenB] = useState(false);
  const [novoBancoNome, setNovoBancoNome] = useState("");
  const [novoBancoCor, setNovoBancoCor] = useState(COLOR_OPTIONS[0]);

  // Confirma atualização de reserva similar
  const [pendingSimilar, setPendingSimilar] = useState<{
    existente: Guardado;
    valorNovo: number;
  } | null>(null);

  function handleSaveBanco() {
    if (!novoBancoNome.trim()) {
      toast.error(t("toasts.bankNameRequired"));
      return;
    }
    addBanco({ nome: novoBancoNome.trim(), colorHex: novoBancoCor });
    toast.success(t("toasts.bankAdded"));
    setNovoBancoNome("");
    setOpenB(false);
  }

  if (!ready) return <PageSkeleton />;

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/app"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label={t("back")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("kicker")}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        </div>
      </header>

      <section className="relative mt-4 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-card via-card to-card-elevated p-5 shadow-elevated animate-rise">
        <div
          className="pointer-events-none absolute -right-6 -top-6 h-48 w-48 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.55), transparent 70%)" }}
        />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-40 w-40 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #06b6d4aa, transparent 70%)" }}
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card-elevated/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
              <ShieldCheck className="h-3 w-3 text-success" />
              {t("badge")}
            </div>
            <p className="mt-3 text-xs font-medium text-muted-foreground">{t("totalLabel")}</p>
            <Money value={total} className="num mt-1 block text-4xl font-extrabold tracking-tight" />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("stats", {
                count: guardado.length,
                plural: guardado.length === 1 ? "" : "s",
                banks: porBanco.size,
                bankPlural: porBanco.size === 1 ? "" : "s",
              })}
            </p>
          </div>
          <img
            src={guardadoHero}
            alt=""
            aria-hidden
            width={1024}
            height={1024}
            loading="lazy"
            className="h-24 w-24 shrink-0 select-none object-contain drop-shadow-[0_8px_24px_rgba(139,92,246,0.35)] sm:h-28 sm:w-28"
          />
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          size="lg"
          className="h-12 rounded-2xl text-sm font-semibold"
          onClick={() => setDialog({ kind: "create" })}
        >
          <Plus className="mr-1 h-4 w-4" />
          {t("actions.newReserve")}
        </Button>

        <Dialog open={openB} onOpenChange={setOpenB}>
          <Button
            variant="outline"
            size="lg"
            className="h-12 rounded-2xl text-sm font-semibold"
            onClick={() => setOpenB(true)}
          >
            <Building2 className="mr-1 h-4 w-4" />
            {t("actions.newBank")}
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("bankDialog.title")}</DialogTitle>
              <DialogDescription>{t("bankDialog.desc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">{t("bankDialog.nameLabel")}</Label>
                <Input
                  value={novoBancoNome}
                  onChange={(e) => setNovoBancoNome(e.target.value)}
                  placeholder={t("bankDialog.namePlaceholder")}
                  className="mt-1 h-11 bg-card-elevated"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{t("bankDialog.colorLabel")}</Label>
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
              <Button variant="outline" onClick={() => setOpenB(false)}>{t("bankDialog.cancel")}</Button>
              <Button onClick={handleSaveBanco}>{t("bankDialog.add")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <section className="mt-5">
        <h2 className="text-sm font-semibold">{t("reserves.title")}</h2>
        {guardado.length === 0 ? (
          <div className="mt-3 flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center animate-rise">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success animate-pop">
              <Wallet className="h-6 w-6" />
            </span>
            <p className="mt-3 text-sm font-semibold text-foreground">
              {t("reserves.emptyTitle")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("reserves.emptyDesc")}
            </p>
            <Button
              size="sm"
              className="card-press rounded-full mt-4"
              onClick={() => setDialog({ kind: "create" })}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t("reserves.firstReserve")}
            </Button>
          </div>
        ) : (
          <ul className="mt-3 space-y-2 stagger">
            {guardado.map((g) => {
              const banco = bancos.find((b) => b.id === g.bancoId);
              return (
                <li key={g.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 hover-lift">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white text-xs font-bold"
                    style={{ background: banco?.colorHex ?? "var(--cat-outros)" }}
                  >
                    {(banco?.nome ?? "?").slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{banco?.nome ?? "Banco"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {tipoLabel(g.tipoReserva, t)} · {t("reserves.updatedAt", { date: formatDateBR(g.dataAtualizacao) })}
                      {g.metaId ? (
                        <>
                          {" "}· <span className="font-semibold text-primary">{t("reserves.metaLabel")}: {metas.find((m) => m.id === g.metaId)?.nome ?? "—"}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <p className="num text-sm font-semibold">{formatBRL(g.valor)}</p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-card-elevated hover:text-foreground"
                        aria-label={t("reserves.actionsLabel")}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onSelect={() => setDialog({ kind: "edit", reserva: g })}>
                        <Pencil className="mr-2 h-4 w-4" />
                        {t("reserves.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setConfirmDelete(g)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t("reserves.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold">{t("banks.title")}</h2>
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
                    onClick={() => { deleteBanco(b.id); toast.success(t("banks.removed")); }}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={t("banks.deleteLabel")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <ReservaFormDialog
        t={t}
        tipoLabel={tipoLabel}
        mode={dialog}
        bancos={bancos}
        onClose={() => setDialog({ kind: "closed" })}
        onDuplicateDetected={(existente, valorNovo) =>
          setPendingSimilar({ existente, valorNovo })
        }
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteReserveDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteReserveDialog.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteReserveDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) {
                  deleteGuardado(confirmDelete.id);
                  toast.success(t("deleteReserveDialog.toast"));
                }
                setConfirmDelete(null);
              }}
            >
              {t("deleteReserveDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingSimilar}
        onOpenChange={(o) => !o && setPendingSimilar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("similarDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("similarDialog.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (pendingSimilar) {
                  const { existente, valorNovo } = pendingSimilar;
                  addGuardado({
                    bancoId: existente.bancoId,
                    valor: valorNovo,
                    tipoReserva: existente.tipoReserva,
                  });
                  toast.success(t("similarDialog.toastCreated"));
                }
                setPendingSimilar(null);
                setDialog({ kind: "closed" });
              }}
            >
              {t("similarDialog.createAnother")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSimilar) {
                  const { existente, valorNovo } = pendingSimilar;
                  updateGuardado(existente.id, { valor: valorNovo });
                  toast.success(t("similarDialog.toastUpdated"));
                }
                setPendingSimilar(null);
                setDialog({ kind: "closed" });
              }}
            >
              {t("similarDialog.updateExisting")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

function ReservaFormDialog({
  t,
  tipoLabel,
  mode,
  bancos,
  onClose,
  onDuplicateDetected,
}: {
  t: (key: string, options?: Record<string, unknown>) => string;
  tipoLabel: (tipo: TipoReserva, t: (key: string) => string) => string;
  mode: DialogMode;
  bancos: ReturnType<typeof getBancos>;
  onClose: () => void;
  onDuplicateDetected: (existente: Guardado, valorNovo: number) => void;
}) {
  const isCreate = mode.kind === "create";
  const isEdit = mode.kind === "edit";
  const open = isCreate || isEdit;
  const baseReserva = isEdit ? mode.reserva : null;
  const metas = useStore(() => getMetas());

  const [bancoId, setBancoId] = useState<string>("");
  const [valorStr, setValorStr] = useState("");
  const [tipoReserva, setTipoReserva] = useState<TipoReserva>("emergencia");
  const [obs, setObs] = useState("");
  const [metaId, setMetaId] = useState<string>("nenhuma");

  useEffect(() => {
    if (!open) return;
    if (isCreate) {
      setBancoId(bancos[0]?.id ?? "");
      setValorStr("");
      setTipoReserva("emergencia");
      setObs("");
      setMetaId("nenhuma");
    } else if (baseReserva) {
      setBancoId(baseReserva.bancoId);
      setValorStr(formatBRL(baseReserva.valor).replace("R$", "").trim());
      setTipoReserva(baseReserva.tipoReserva);
      setObs(baseReserva.observacao ?? "");
      setMetaId(baseReserva.metaId ?? "nenhuma");
    }
  }, [open, isCreate, baseReserva, bancos]);

  function handleSave() {
    const valor = parseBRLInput(valorStr);
    if (!valor || !bancoId) {
      toast.error(t("toasts.bankNameRequired"));
      return;
    }
    const metaIdFinal = metaId === "nenhuma" ? undefined : metaId;
    if (isCreate) {
      const similar = findReservaSimilar(bancoId, tipoReserva);
      if (similar) {
        onDuplicateDetected(similar, valor);
        return;
      }
      addGuardado({ bancoId, valor, tipoReserva, observacao: obs.trim() || undefined, metaId: metaIdFinal });
      toast.success(t("toasts.valueSaved"));
      onClose();
      return;
    }
    if (isEdit && baseReserva) {
      updateGuardado(baseReserva.id, {
        bancoId,
        valor,
        tipoReserva,
        observacao: obs.trim() || undefined,
        metaId: metaIdFinal,
      });
      toast.success(t("toasts.reserveAdjusted"));
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCreate ? t("form.createTitle") : t("form.editTitle")}</DialogTitle>
          <DialogDescription>
            {isCreate ? t("form.createDesc") : t("form.editDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">{t("form.bankLabel")}</Label>
            <Select value={bancoId} onValueChange={setBancoId}>
              <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                <SelectValue placeholder={t("form.bankPlaceholder")} />
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
              <Label className="text-xs text-muted-foreground">{t("form.valueLabel")}</Label>
              <Input
                inputMode="decimal"
                value={valorStr}
                onChange={(e) => setValorStr(e.target.value)}
                placeholder="0,00"
                className="num mt-1 h-11 bg-card-elevated"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{t("form.typeLabel")}</Label>
              <Select value={tipoReserva} onValueChange={(v) => setTipoReserva(v as TipoReserva)}>
                <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_RESERVA.map((tr) => (
                    <SelectItem key={tr.id} value={tr.id}>{tipoLabel(tr.id, t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("form.metaLabel")}</Label>
            <Select value={metaId} onValueChange={setMetaId}>
              <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhuma">{t("form.metaNone")}</SelectItem>
                {metas.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("form.metaHelp")}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("form.obsLabel")}</Label>
            <Textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder={t("form.obsPlaceholder")}
              className="mt-1 min-h-[60px] bg-card-elevated"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("form.cancel")}</Button>
          <Button onClick={handleSave}>{isCreate ? t("form.save") : t("form.saveEdit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
