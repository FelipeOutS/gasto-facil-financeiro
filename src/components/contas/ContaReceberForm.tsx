import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
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
import { toast } from "sonner";
import { toastFromError } from "@/lib/premium-error";
import { formatBRL, parseBRLInput, todayISO } from "@/lib/format";
import {
  type ContaReceber,
  type NovaContaReceberInput,
  TIPOS_RECEBIMENTO,
  FORMAS_RECEBIMENTO,
  criarContaReceber,
  atualizarContaReceber,
} from "@/lib/contas-receber";
import { useClientes } from "@/lib/clientes";
import { ClienteSelect } from "@/components/ClienteSelect";
import { cn } from "@/lib/utils";

export type ContaReceberFormProps = {
  editing?: ContaReceber | null;
  userId: string | undefined;
  onSaved: () => void;
  onCancel?: () => void;
  fullWidthActions?: boolean;
};

export function ContaReceberForm({
  editing,
  userId,
  onSaved,
  onCancel,
  fullWidthActions,
}: ContaReceberFormProps) {
  const { t } = useTranslation("contas-a-receber");
  const { ativos: clientesAtivos } = useClientes();

  const [titulo, setTitulo] = useState(editing?.titulo ?? "");
  const [pagador, setPagador] = useState(editing?.pagador_nome ?? "");
  const [tipo, setTipo] = useState<string>(editing?.tipo_recebimento ?? "cliente");
  const [valor, setValor] = useState(
    editing ? formatBRL(Number(editing.valor_total)).replace("R$", "").trim() : "",
  );
  const [dataPrevista, setDataPrevista] = useState(editing?.data_prevista ?? todayISO());
  const [categoria, setCategoria] = useState(editing?.categoria ?? "");
  const [forma, setForma] = useState<string>((editing?.forma_recebimento as string) ?? "");
  const [observacao, setObservacao] = useState(editing?.observacao ?? "");
  const [clienteId, setClienteId] = useState<string | null>(editing?.cliente_id ?? null);
  const [saving, setSaving] = useState(false);

  // Reset when switching editing target
  useEffect(() => {
    if (!editing) return;
    setTitulo(editing.titulo);
    setPagador(editing.pagador_nome ?? "");
    setTipo(editing.tipo_recebimento);
    setValor(formatBRL(Number(editing.valor_total)).replace("R$", "").trim());
    setDataPrevista(editing.data_prevista);
    setCategoria(editing.categoria ?? "");
    setForma((editing.forma_recebimento as string) ?? "");
    setObservacao(editing.observacao ?? "");
    setClienteId(editing.cliente_id ?? null);
  }, [editing]);

  async function handleSubmit() {
    if (!userId) return;
    const tituloTrim = titulo.trim();
    if (!tituloTrim) {
      toast.error(t("form.errTitle"));
      return;
    }
    const valorNum = parseBRLInput(valor);
    if (!valorNum || valorNum <= 0) {
      toast.error(t("form.errValue"));
      return;
    }
    if (!dataPrevista) {
      toast.error(t("form.errDate"));
      return;
    }

    setSaving(true);
    try {
      const payload: NovaContaReceberInput = {
        titulo: tituloTrim,
        pagador_nome: pagador || null,
        tipo_recebimento: tipo,
        valor_total: valorNum,
        data_prevista: dataPrevista,
        categoria: categoria || null,
        forma_recebimento: forma || null,
        observacao: observacao || null,
        cliente_id: clienteId,
      };
      if (editing) {
        await atualizarContaReceber(editing.id, payload);
        toast.success(t("form.toastUpdated"));
      } else {
        await criarContaReceber(userId, payload);
        toast.success(t("form.toastCreated"));
      }
      onSaved();
    } catch (e) {
      console.error(e);
      toastFromError(e, t("form.toastError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="cr-titulo">{t("form.titleLabel")}</Label>
        <Input
          id="cr-titulo"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder={t("form.titlePlaceholder")}
          maxLength={120}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cr-valor">{t("form.value")}</Label>
          <Input
            id="cr-valor"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder={t("form.valuePlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cr-data">{t("form.expectedDate")}</Label>
          <Input
            id="cr-data"
            type="date"
            value={dataPrevista}
            onChange={(e) => setDataPrevista(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("form.tipo")}</Label>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_RECEBIMENTO.map((tp) => (
                <SelectItem key={tp.id} value={tp.id}>
                  {t(`tipos.${tp.id}` as const, { defaultValue: tp.label })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("form.forma")}</Label>
          <Select
            value={forma || "__none"}
            onValueChange={(v) => setForma(v === "__none" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("form.none")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">{t("form.none")}</SelectItem>
              {FORMAS_RECEBIMENTO.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {t(`formas.${f.id}` as const, { defaultValue: f.label })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cr-pagador">{t("form.payer")}</Label>
        <Input
          id="cr-pagador"
          value={pagador}
          onChange={(e) => setPagador(e.target.value)}
          placeholder={t("form.payerPlaceholder")}
          maxLength={120}
        />
      </div>
      <ClienteSelect value={clienteId} onChange={setClienteId} clientesAtivos={clientesAtivos} />
      <div className="space-y-1.5">
        <Label htmlFor="cr-categoria">{t("form.category")}</Label>
        <Input
          id="cr-categoria"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          placeholder={t("form.categoryPlaceholder")}
          maxLength={60}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cr-obs">{t("form.obs")}</Label>
        <Textarea
          id="cr-obs"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          maxLength={500}
          rows={2}
        />
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
            className={fullWidthActions ? "w-full sm:w-auto" : undefined}
          >
            <X className="mr-1 h-4 w-4" />
            {t("form.cancel")}
          </Button>
        )}
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className={fullWidthActions ? "w-full sm:w-auto" : undefined}
        >
          <Check className="mr-1 h-4 w-4" />
          {editing ? t("form.save") : t("form.create")}
        </Button>
      </div>
    </div>
  );
}
