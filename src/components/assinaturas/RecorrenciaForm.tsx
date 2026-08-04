import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useStore, getCategorias, getCartoes } from "@/lib/store";
import {
  atualizarRecorrencia,
  criarRecorrencia,
  type FrequenciaRecorrencia,
  type Recorrencia,
  type StatusRecorrencia,
} from "@/lib/recorrencias";
import { FORMAS_PAGAMENTO, type FormaPagamento } from "@/lib/types";
import { formatBRL, parseBRLInput, toLocalISODate } from "@/lib/format";
import { requireOnline } from "@/lib/use-online-status";
import { getEconomicRadar } from "@/lib/radar.functions";

const FREQ_KEYS: FrequenciaRecorrencia[] = [
  "mensal",
  "semanal",
  "quinzenal",
  "anual",
  "personalizada",
];

export interface RecorrenciaFormProps {
  editing: Recorrencia | null;
  userId: string | null;
  onSaved: () => void;
  onCancel: () => void;
  /** When true (mobile page), buttons stretch full width. */
  fullWidthActions?: boolean;
}

export function RecorrenciaForm({
  editing,
  userId,
  onSaved,
  onCancel,
  fullWidthActions = false,
}: RecorrenciaFormProps) {
  const { t } = useTranslation("assinaturas");
  const freqLabel = (f: FrequenciaRecorrencia) => t(`freq.${f}`);
  const statusLabel = (s: StatusRecorrencia) => t(`status.${s}`);

  const categorias = useStore(getCategorias);
  const cartoes = useStore(getCartoes);

  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [moeda, setMoeda] = useState<"BRL" | "USD" | "EUR">("BRL");
  const [valorOriginal, setValorOriginal] = useState("");
  const [cotacaoUSD, setCotacaoUSD] = useState<number | null>(null);
  const [cotacaoEUR, setCotacaoEUR] = useState<number | null>(null);
  const [categoriaId, setCategoriaId] = useState<string>("");
  const [frequencia, setFrequencia] = useState<FrequenciaRecorrencia>("mensal");
  const [proximaCobranca, setProximaCobranca] = useState<string>("");
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | "">("");
  const [cartaoId, setCartaoId] = useState<string>("");
  const [observacao, setObservacao] = useState("");
  const [status, setStatus] = useState<StatusRecorrencia>("ativa");
  const [saving, setSaving] = useState(false);

  const fetchRadar = useServerFn(getEconomicRadar);
  useEffect(() => {
    fetchRadar()
      .then((r) => {
        const indicators = (r as { indicators?: Array<{ key: string; value: number }> }).indicators || [];
        const usd = indicators.find((i) => i.key === "USD_BRL");
        const eur = indicators.find((i) => i.key === "EUR_BRL");
        setCotacaoUSD(usd?.value ?? null);
        setCotacaoEUR(eur?.value ?? null);
      })
      .catch(() => {});
  }, [fetchRadar]);

  useEffect(() => {
    if (moeda === "BRL") return;
    const cot = moeda === "USD" ? cotacaoUSD : cotacaoEUR;
    const n = parseBRLInput(valorOriginal);
    if (cot && Number.isFinite(n) && n > 0) {
      const brl = n * cot * 1.075;
      setValor(brl.toFixed(2).replace(".", ","));
    }
  }, [moeda, valorOriginal, cotacaoUSD, cotacaoEUR]);

  useEffect(() => {
    if (editing) {
      setNome(editing.nome);
      setValor(editing.valor.toFixed(2).replace(".", ","));
      setMoeda((editing.moeda ?? "BRL") as "BRL" | "USD" | "EUR");
      setValorOriginal(
        editing.valorOriginal != null ? editing.valorOriginal.toFixed(2).replace(".", ",") : "",
      );
      setCategoriaId(editing.categoriaId ?? "");
      setFrequencia(editing.frequencia);
      setProximaCobranca(editing.proximaCobranca ?? "");
      setFormaPagamento((editing.formaPagamento ?? "") as FormaPagamento | "");
      setCartaoId(editing.cartaoId ?? "");
      setObservacao(editing.observacao ?? "");
      setStatus(editing.status);
    } else {
      setNome("");
      setValor("");
      setMoeda("BRL");
      setValorOriginal("");
      setCategoriaId("");
      setFrequencia("mensal");
      setProximaCobranca(toLocalISODate(new Date()));
      setFormaPagamento("");
      setCartaoId("");
      setObservacao("");
      setStatus("ativa");
    }
  }, [editing]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const valorNum = parseBRLInput(valor);
    if (!nome.trim() || valorNum <= 0) {
      toast.error(t("toasts.invalid"));
      return;
    }
    if (!(await requireOnline())) return;
    setSaving(true);
    const valorOriginalNum = moeda !== "BRL" ? parseBRLInput(valorOriginal) : null;
    try {
      if (editing) {
        await atualizarRecorrencia(editing.id, {
          nome: nome.trim(),
          valor: valorNum,
          categoriaId: categoriaId || null,
          frequencia,
          proximaCobranca: proximaCobranca || null,
          formaPagamento: (formaPagamento || null) as FormaPagamento | null,
          cartaoId: cartaoId || null,
          observacao: observacao || null,
          status,
          moeda,
          valorOriginal: valorOriginalNum,
        });
        toast.success(t("toasts.updated"));
      } else {
        await criarRecorrencia(userId, {
          nome: nome.trim(),
          valor: valorNum,
          categoriaId: categoriaId || null,
          frequencia,
          proximaCobranca: proximaCobranca || null,
          formaPagamento: (formaPagamento || null) as FormaPagamento | null,
          cartaoId: cartaoId || null,
          observacao: observacao || null,
          status,
          origem: "manual",
          moeda,
          valorOriginal: valorOriginalNum,
        });
        toast.success(t("toasts.created"));
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-medium">{t("dialog.name")}</label>
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={t("dialog.namePlaceholder")}
        />
      </div>
      <div>
        <label className="text-xs font-medium">{t("dialog.currency")}</label>
        <Select value={moeda} onValueChange={(v) => setMoeda(v as "BRL" | "USD" | "EUR")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BRL">{t("dialog.currencyBRL")}</SelectItem>
            <SelectItem value="USD">{t("dialog.currencyUSD")}</SelectItem>
            <SelectItem value="EUR">{t("dialog.currencyEUR")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {moeda !== "BRL" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium">
              {moeda === "USD" ? t("dialog.valueInUSD") : t("dialog.valueInEUR")}
            </label>
            <Input
              value={valorOriginal}
              onChange={(e) => setValorOriginal(e.target.value)}
              inputMode="decimal"
              placeholder={moeda === "USD" ? t("dialog.phUSD") : t("dialog.phEUR")}
            />
          </div>
          <div>
            <label className="text-xs font-medium">{t("dialog.currentRate")}</label>
            <Input
              readOnly
              value={
                (moeda === "USD" ? cotacaoUSD : cotacaoEUR)
                  ? formatBRL((moeda === "USD" ? cotacaoUSD : cotacaoEUR) as number)
                  : "—"
              }
              className="bg-muted/40"
            />
          </div>
          <p className="col-span-2 rounded-md bg-muted/30 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {t("dialog.estimateHint")}
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium">
            {moeda === "BRL" ? t("dialog.valueBRL") : t("dialog.estimateBRL")}
          </label>
          <Input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
          />
        </div>
        <div>
          <label className="text-xs font-medium">{t("dialog.frequency")}</label>
          <Select
            value={frequencia}
            onValueChange={(v) => setFrequencia(v as FrequenciaRecorrencia)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREQ_KEYS.map((f) => (
                <SelectItem key={f} value={f}>
                  {freqLabel(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium">{t("dialog.next")}</label>
        <Input
          type="date"
          value={proximaCobranca}
          onChange={(e) => setProximaCobranca(e.target.value)}
        />
      </div>
      <div>
        <label className="text-xs font-medium">{t("dialog.category")}</label>
        <Select
          value={categoriaId || "__none__"}
          onValueChange={(v) => setCategoriaId(v === "__none__" ? "" : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("dialog.categorySelect")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("dialog.noCategory")}</SelectItem>
            {categorias.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium">{t("dialog.payment")}</label>
          <Select
            value={formaPagamento || "__none__"}
            onValueChange={(v) =>
              setFormaPagamento((v === "__none__" ? "" : v) as FormaPagamento | "")
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("dialog.categorySelect")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("dialog.paymentNone")}</SelectItem>
              {FORMAS_PAGAMENTO.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium">{t("dialog.card")}</label>
          <Select
            value={cartaoId || "__none__"}
            onValueChange={(v) => setCartaoId(v === "__none__" ? "" : v)}
            disabled={formaPagamento !== "credito"}
          >
            <SelectTrigger>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("dialog.noCard")}</SelectItem>
              {cartoes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium">{t("dialog.status")}</label>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusRecorrencia)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["ativa", "pausada", "cancelada"] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {statusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs font-medium">{t("dialog.note")}</label>
        <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
      </div>
      <div
        className={
          fullWidthActions
            ? "flex flex-col gap-2 pt-2"
            : "flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end"
        }
      >
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className={fullWidthActions ? "w-full min-h-11" : ""}
        >
          {t("actions.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={saving}
          className={fullWidthActions ? "w-full min-h-11" : ""}
        >
          {saving ? t("actions.saving") : editing ? t("actions.save") : t("actions.create")}
        </Button>
      </div>
    </form>
  );
}

/** Desktop wrapper — thin Dialog around RecorrenciaForm. */
export function RecorrenciaDialog({
  open,
  onOpenChange,
  editing,
  userId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Recorrencia | null;
  userId: string | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation("assinaturas");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t("dialog.titleEdit") : t("dialog.titleNew")}</DialogTitle>
          <DialogDescription>
            {editing ? t("dialog.descEdit") : t("dialog.descNew")}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <RecorrenciaForm
            key={editing?.id ?? "new"}
            editing={editing}
            userId={userId}
            onSaved={onSaved}
            onCancel={() => onOpenChange(false)}
          />
        )}
        <DialogFooter className="hidden" />
      </DialogContent>
    </Dialog>
  );
}
