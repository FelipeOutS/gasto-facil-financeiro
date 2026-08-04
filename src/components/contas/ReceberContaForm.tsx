import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { toastFromError } from "@/lib/premium-error";
import { formatBRL, parseBRLInput, todayISO } from "@/lib/format";
import { type ContaReceber, FORMAS_RECEBIMENTO, marcarRecebida } from "@/lib/contas-receber";
import { cn } from "@/lib/utils";

export type ReceberContaFormProps = {
  conta: ContaReceber;
  onConfirmed: () => void;
  onCancel?: () => void;
  fullWidthActions?: boolean;
};

export function ReceberContaForm({
  conta,
  onConfirmed,
  onCancel,
  fullWidthActions,
}: ReceberContaFormProps) {
  const { t } = useTranslation("contas-a-receber");
  const [valorAgora, setValorAgora] = useState("");
  const [data, setData] = useState(todayISO());
  const [forma, setForma] = useState<string>((conta.forma_recebimento as string) ?? "");
  const [parcial, setParcial] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValorAgora("");
    setData(todayISO());
    setForma((conta.forma_recebimento as string) ?? "");
    setParcial(false);
  }, [conta.id, conta.forma_recebimento]);

  const restante = Math.max(0, Number(conta.valor_total) - Number(conta.valor_recebido));

  async function handleConfirm() {
    setSaving(true);
    try {
      const opts: {
        valor_recebido_agora?: number;
        data_recebimento?: string;
        forma_recebimento?: string | null;
      } = {
        data_recebimento: data,
        forma_recebimento: forma || null,
      };
      if (parcial) {
        const v = parseBRLInput(valorAgora);
        if (!v || v <= 0) {
          toast.error(t("receive.errAmount"));
          setSaving(false);
          return;
        }
        opts.valor_recebido_agora = v;
      }
      await marcarRecebida(conta.id, opts);
      toast.success(t("receive.toastSuccess"));
      onConfirmed();
    } catch (e) {
      console.error(e);
      toastFromError(e, t("receive.toastError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("receive.desc", { name: conta.titulo, amount: formatBRL(restante) })}
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={parcial}
          onChange={(e) => setParcial(e.target.checked)}
          className="h-4 w-4"
        />
        {t("receive.partial")}
      </label>

      {parcial && (
        <div className="space-y-1.5">
          <Label htmlFor="rc-valor">{t("receive.amountNow")}</Label>
          <Input
            id="rc-valor"
            inputMode="decimal"
            value={valorAgora}
            onChange={(e) => setValorAgora(e.target.value)}
            placeholder="0,00"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rc-data">{t("receive.date")}</Label>
          <Input id="rc-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("receive.forma")}</Label>
          <Select
            value={forma || "__none"}
            onValueChange={(v) => setForma(v === "__none" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("receive.none")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">{t("receive.none")}</SelectItem>
              {FORMAS_RECEBIMENTO.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {t(`formas.${f.id}` as const, { defaultValue: f.label })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        className={cn(
          "flex gap-2 pt-2",
          fullWidthActions ? "flex-col-reverse sm:flex-row sm:justify-end" : "justify-end",
        )}
      >
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className={cn("min-h-11", fullWidthActions ? "w-full sm:w-auto" : undefined)}
          >
            {t("receive.cancel")}
          </Button>
        )}
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={saving}
          className={cn("min-h-11", fullWidthActions ? "w-full sm:w-auto" : undefined)}
        >
          <Check className="mr-1 h-4 w-4" />
          {t("receive.confirm")}
        </Button>
      </div>
    </div>
  );
}
