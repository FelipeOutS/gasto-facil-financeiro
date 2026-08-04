import { useEffect, useState } from "react";
import { Upload, Check, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePlan } from "@/lib/use-plan";
import { PremiumLockModal } from "@/components/PremiumLockModal";

import {
  MetaCover,
  getMetaCoverKey,
  META_COVER_OPTIONS,
  CUSTOM_COVER_PREFIX,
  isCustomCoverKey,
} from "@/components/MetaCover";
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
import { addMeta, updateMeta } from "@/lib/store";
import { requireOnline } from "@/lib/use-online-status";
import type { Meta } from "@/lib/types";
import { formatBRL, parseBRLInput } from "@/lib/format";
import { cn } from "@/lib/utils";

export const META_COLORS = [
  "#34d399",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#fb923c",
  "#fde047",
  "#22d3ee",
  "#f87171",
  "#e879f9",
  "#94a3b8",
];

export type MetaFormMode =
  | { kind: "create" }
  | { kind: "edit"; meta: Meta }
  | { kind: "add"; meta: Meta }
  | { kind: "remove"; meta: Meta };

export interface MetaFormProps {
  mode: MetaFormMode;
  bancos: Array<{ id: string; nome: string }>;
  onClose: () => void;
  /** Use full-width primary action button (mobile pages). */
  fullWidthActions?: boolean;
  /** Hide the cancel button (mobile pages use header back instead). */
  hideCancel?: boolean;
}

export function MetaForm({
  mode,
  bancos,
  onClose,
  fullWidthActions = false,
  hideCancel = false,
}: MetaFormProps) {
  const { t } = useTranslation("metas");
  const isCreate = mode.kind === "create";
  const isEdit = mode.kind === "edit";
  const isAdd = mode.kind === "add";
  const isRemove = mode.kind === "remove";
  const baseMeta = isEdit || isAdd || isRemove ? mode.meta : null;

  const [nome, setNome] = useState("");
  const [objetivoStr, setObjetivoStr] = useState("");
  const [acumuladoStr, setAcumuladoStr] = useState("");
  const [prazo, setPrazo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [colorHex, setColorHex] = useState(META_COLORS[0]);
  const [bancoId, setBancoId] = useState<string>("nenhum");
  const [valorStr, setValorStr] = useState("");
  const [imagemKey, setImagemKey] = useState<string>("objetivo");
  const [imagemManual, setImagemManual] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { can } = usePlan();
  const canVisuais = can("metas_visuais");
  const [premiumOpen, setPremiumOpen] = useState(false);

  async function handleUploadCover(file: File) {
    if (!canVisuais) {
      setPremiumOpen(true);
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error(t("upload.errType"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("upload.errSize"));
      return;
    }
    setUploading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error(t("upload.errAuth"));
        return;
      }
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("metas-covers")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        toast.error(t("upload.errUpload"));
        return;
      }
      setImagemKey(`${CUSTOM_COVER_PREFIX}${path}`);
      setImagemManual(true);
      toast.success(t("upload.success"));
    } finally {
      setUploading(false);
    }
  }

  // Reset state when mode changes
  useEffect(() => {
    if (isCreate) {
      setNome("");
      setObjetivoStr("");
      setAcumuladoStr("");
      setPrazo("");
      setDescricao("");
      setColorHex(META_COLORS[0]);
      setBancoId("nenhum");
      setImagemKey("objetivo");
      setImagemManual(false);
    } else if (baseMeta) {
      setNome(baseMeta.nome);
      setObjetivoStr(formatBRL(baseMeta.valorObjetivo).replace("R$", "").trim());
      setAcumuladoStr(formatBRL(baseMeta.valorAtual).replace("R$", "").trim());
      setPrazo(baseMeta.prazo ?? "");
      setDescricao(baseMeta.descricao ?? "");
      setColorHex(baseMeta.colorHex);
      setBancoId(baseMeta.bancoId ?? "nenhum");
      const persistida = baseMeta.imagemKey;
      setImagemKey(persistida ?? getMetaCoverKey(baseMeta.nome, baseMeta.descricao));
      setImagemManual(!!persistida);
    }
    if (isAdd && baseMeta) {
      setValorStr(formatBRL(baseMeta.valorAtual).replace("R$", "").trim());
    } else {
      setValorStr("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.kind, baseMeta?.id]);

  // Auto-match cover from name/description while user hasn't picked manually.
  useEffect(() => {
    if (imagemManual) return;
    if (!isCreate && !isEdit) return;
    setImagemKey(getMetaCoverKey(nome, descricao));
  }, [nome, descricao, imagemManual, isCreate, isEdit]);

  async function handleCreateOrEdit() {
    const objetivo = parseBRLInput(objetivoStr);
    if (!nome.trim() || !objetivo) {
      toast.error(t("toasts.missing"));
      return;
    }
    if (!(await requireOnline())) return;
    if (isCreate) {
      const created = addMeta({
        nome: nome.trim(),
        valorObjetivo: objetivo,
        valorAtual: parseBRLInput(acumuladoStr) || 0,
        prazo: prazo || undefined,
        descricao: descricao.trim() || undefined,
        colorHex,
        bancoId: bancoId === "nenhum" ? undefined : bancoId,
        imagemKey,
      });
      if (!created) return; // bloqueado por assinatura — toast já exibido
      toast.success(t("toasts.created"));
      onClose();
      return;
    }
    if (isEdit && baseMeta) {
      const novoAcumulado = parseBRLInput(acumuladoStr) || 0;
      if (novoAcumulado > objetivo) {
        toast.warning(t("toasts.overGoal"));
      }
      updateMeta(baseMeta.id, {
        nome: nome.trim(),
        valorObjetivo: objetivo,
        valorAtual: novoAcumulado,
        prazo: prazo || undefined,
        descricao: descricao.trim() || undefined,
        colorHex,
        bancoId: bancoId === "nenhum" ? undefined : bancoId,
        imagemKey,
      });
      toast.success(t("toasts.updated"));
      onClose();
    }
  }

  async function handleAddValor() {
    if (!baseMeta) return;
    const trimmed = valorStr.trim();
    if (trimmed === "") {
      toast.error(t("toasts.informValue"));
      return;
    }
    const v = parseBRLInput(valorStr);
    if (v < 0 || Number.isNaN(v)) {
      toast.error(t("toasts.negative"));
      return;
    }
    if (!(await requireOnline())) return;
    updateMeta(baseMeta.id, { valorAtual: v });
    if (baseMeta.valorObjetivo > 0 && v > baseMeta.valorObjetivo) {
      toast.success(t("toasts.passedGoal"));
    } else {
      toast.success(t("toasts.adjusted"));
    }
    onClose();
  }

  async function handleRemoverValor() {
    if (!baseMeta) return;
    const v = parseBRLInput(valorStr);
    if (!v) {
      toast.error(t("toasts.informAValue"));
      return;
    }
    if (!(await requireOnline())) return;
    const novo = Math.max(0, baseMeta.valorAtual - v);
    updateMeta(baseMeta.id, { valorAtual: novo });
    toast.success(t("toasts.valueAdjusted"));
    onClose();
  }

  return (
    <div className="space-y-4">
      {(isCreate || isEdit) && (
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">{t("dialog.name")}</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("dialog.namePlaceholder")}
              className="mt-1 h-11 bg-card-elevated"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">{t("dialog.goalValue")}</Label>
              <Input
                inputMode="decimal"
                value={objetivoStr}
                onChange={(e) => setObjetivoStr(e.target.value)}
                placeholder="0,00"
                className="num mt-1 h-11 bg-card-elevated"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("dialog.goalValueHelper")}
              </p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                {isEdit ? t("dialog.accumulatedValue") : t("dialog.savedValue")}
              </Label>
              <Input
                inputMode="decimal"
                value={acumuladoStr}
                onChange={(e) => setAcumuladoStr(e.target.value)}
                placeholder="0,00"
                className="num mt-1 h-11 bg-card-elevated"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("dialog.savedValueHelper")}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">{t("dialog.deadline")}</Label>
              <Input
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
                className="mt-1 h-11 bg-card-elevated"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{t("dialog.deadlineHelper")}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{t("dialog.linkedBank")}</Label>
              <Select value={bancoId} onValueChange={setBancoId}>
                <SelectTrigger className="mt-1 h-11 bg-card-elevated">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">{t("dialog.none")}</SelectItem>
                  {bancos.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("dialog.linkedBankHelper")}
              </p>
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("dialog.description")}</Label>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder={t("dialog.descriptionPlaceholder")}
              className="mt-1 min-h-[60px] bg-card-elevated"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("dialog.descriptionHelper")}
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">{t("dialog.goalImage")}</Label>
              {imagemManual && (
                <button
                  type="button"
                  onClick={() => {
                    setImagemManual(false);
                    setImagemKey(getMetaCoverKey(nome, descricao));
                  }}
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  {t("dialog.useAutoSuggestion")}
                </button>
              )}
            </div>
            <div className="mt-2 overflow-hidden rounded-2xl border border-border">
              <MetaCover coverKey={imagemKey} className="h-28 w-full" />
            </div>

            {canVisuais ? (
              <>
                <label
                  className={cn(
                    "mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card-elevated/40 px-3 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground",
                    uploading && "pointer-events-none opacity-60",
                  )}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {uploading ? t("dialog.uploading") : t("dialog.uploadOwn")}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadCover(f);
                      e.target.value = "";
                    }}
                  />
                </label>

                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("dialog.orChooseSuggestion")}
                </p>
                <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {META_COVER_OPTIONS.map((opt) => {
                    const active = imagemKey === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => {
                          setImagemKey(opt.key);
                          setImagemManual(true);
                        }}
                        className={cn(
                          "group relative aspect-square overflow-hidden rounded-xl border-2 transition-all",
                          active
                            ? "border-foreground scale-[1.03] shadow-md"
                            : "border-transparent hover:border-border",
                        )}
                        title={opt.label}
                        aria-label={opt.label}
                      >
                        <MetaCover coverKey={opt.key} className="h-full w-full" />
                        {active && (
                          <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-foreground text-background shadow">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {isCustomCoverKey(imagemKey)
                    ? t("dialog.imageCustom")
                    : imagemManual
                      ? t("dialog.imageManual")
                      : t("dialog.imageAuto")}
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setPremiumOpen(true)}
                className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-3 text-left transition-colors hover:bg-amber-500/10"
              >
                <span className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs font-semibold text-foreground">
                    {t("dialog.visualPremiumTitle")}
                  </span>
                </span>
                <span className="text-[11px] font-semibold text-amber-500">
                  {t("dialog.visualPremiumCta")}
                </span>
              </button>
            )}
            <PremiumLockModal
              open={premiumOpen}
              onOpenChange={setPremiumOpen}
              title={t("dialog.visualPremiumTitle")}
              description={t("dialog.visualPremiumDesc")}
              feature="metas_visuais"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("dialog.color")}</Label>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("dialog.color")}</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {META_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColorHex(c)}
                  className={cn(
                    "h-8 w-8 rounded-full border-2 transition-all",
                    colorHex === c ? "border-foreground scale-110" : "border-transparent",
                  )}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {(isAdd || isRemove) && baseMeta && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-card-elevated p-3">
            <p className="text-xs text-muted-foreground">{t("dialog.currentAccumulated")}</p>
            <p className="num text-xl font-bold">{formatBRL(baseMeta.valorAtual)}</p>
            <p className="num mt-1 text-xs text-muted-foreground">
              {t("dialog.goalLabel", { value: formatBRL(baseMeta.valorObjetivo) })}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">
              {isAdd ? t("dialog.addValueLabel") : t("dialog.removeValueLabel")}
            </Label>
            <Input
              inputMode="decimal"
              value={valorStr}
              onChange={(e) => setValorStr(e.target.value)}
              placeholder="0,00"
              className="num mt-1 h-11 bg-card-elevated"
              autoFocus
            />
            {isAdd && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">{t("dialog.addValueHint")}</p>
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          "flex gap-2 pt-2",
          fullWidthActions ? "flex-col-reverse" : "flex-col-reverse sm:flex-row sm:justify-end",
        )}
      >
        {!hideCancel && (
          <Button
            variant="outline"
            onClick={onClose}
            className={fullWidthActions ? "w-full min-h-11" : ""}
          >
            {t("dialog.cancel")}
          </Button>
        )}
        {(isCreate || isEdit) && (
          <Button
            onClick={handleCreateOrEdit}
            className={fullWidthActions ? "w-full min-h-11" : ""}
          >
            {isCreate ? t("dialog.create") : t("dialog.save")}
          </Button>
        )}
        {isAdd && (
          <Button onClick={handleAddValor} className={fullWidthActions ? "w-full min-h-11" : ""}>
            {t("dialog.saveValue")}
          </Button>
        )}
        {isRemove && (
          <Button
            onClick={handleRemoverValor}
            className={fullWidthActions ? "w-full min-h-11" : ""}
          >
            {t("dialog.removeValue")}
          </Button>
        )}
      </div>
    </div>
  );
}

export type MetaDialogMode = MetaFormMode | { kind: "closed" };

/** Desktop dialog wrapper — preserves the previous modal behavior. */
export function MetaFormDialog({
  mode,
  bancos,
  onClose,
}: {
  mode: MetaDialogMode;
  bancos: Array<{ id: string; nome: string }>;
  onClose: () => void;
}) {
  const { t } = useTranslation("metas");
  const open = mode.kind !== "closed";
  const isCreate = mode.kind === "create";
  const isEdit = mode.kind === "edit";
  const isAdd = mode.kind === "add";
  const isRemove = mode.kind === "remove";
  const baseMeta =
    mode.kind === "edit" || mode.kind === "add" || mode.kind === "remove" ? mode.meta : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isCreate && t("dialog.createTitle")}
            {isEdit && t("dialog.editTitle")}
            {isAdd && t("dialog.addTitle")}
            {isRemove && t("dialog.removeTitle")}
          </DialogTitle>
          <DialogDescription>
            {isCreate && t("dialog.createDesc")}
            {isEdit && t("dialog.editDesc")}
            {isAdd && t("dialog.addDesc")}
            {isRemove && t("dialog.removeDesc", { name: baseMeta?.nome ?? "" })}
          </DialogDescription>
        </DialogHeader>
        {open && <MetaForm mode={mode as MetaFormMode} bancos={bancos} onClose={onClose} />}
        {/* DialogFooter rendered inside MetaForm for unified layout */}
        <DialogFooter className="hidden" />
      </DialogContent>
    </Dialog>
  );
}
