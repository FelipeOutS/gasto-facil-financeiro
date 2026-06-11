import { useEffect, useMemo, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { toast } from "sonner";
import {
  addReceita,
  getReceitas,
  updateReceita,
  useStore,
  type UpdateReceitaScope,
} from "@/lib/store";
import { requireOnline, isOnline } from "@/lib/use-online-status";
import { enqueueIncome } from "@/lib/offline/offline-income-queue";
import { TIPOS_RECEITA, type Receita, type TipoReceita } from "@/lib/types";
import { formatBRL, parseBRLInput, todayISO } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import { useClientes } from "@/lib/clientes";
import { ClienteSelect } from "@/components/ClienteSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

function normalizeDescricao(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ReceitaFormPreset = {
  tipo?: TipoReceita;
  recorrente?: boolean;
  descricao?: string;
};

type Props =
  | {
      mode: "create";
      preset?: ReceitaFormPreset;
      onDone: () => void;
      onCancel: () => void;
    }
  | {
      mode: "edit";
      receita: Receita;
      onDone: () => void;
      onCancel: () => void;
    };

export function ReceitaForm(props: Props) {
  const { t } = useTranslation("renda");
  const { user } = useAuth();
  const { ativos: clientesAtivos } = useClientes();
  const receitas = useStore(() => getReceitas());

  const isEdit = props.mode === "edit";
  const initial = isEdit
    ? {
        descricao: props.receita.descricao,
        valorStr: props.receita.valor.toFixed(2).replace(".", ","),
        data: props.receita.data,
        tipo: props.receita.tipo,
        recorrente: !!props.receita.recorrente,
        clienteId: props.receita.clienteId ?? null,
      }
    : {
        descricao: props.preset?.descricao ?? "",
        valorStr: "",
        data: todayISO(),
        tipo: (props.preset?.tipo ?? "salario") as TipoReceita,
        recorrente: props.preset?.recorrente ?? true,
        clienteId: null as string | null,
      };

  const [descricao, setDescricao] = useState(initial.descricao);
  const [valorStr, setValorStr] = useState(initial.valorStr);
  const [data, setData] = useState(initial.data);
  const [tipo, setTipo] = useState<TipoReceita>(initial.tipo);
  const [recorrente, setRecorrente] = useState<boolean>(initial.recorrente);
  const [meses, setMeses] = useState(12);
  const [clienteId, setClienteId] = useState<string | null>(initial.clienteId);
  const [scope, setScope] = useState<UpdateReceitaScope>("single");

  type NovaPayload = {
    descricao: string;
    valor: number;
    data: string;
    tipo: TipoReceita;
    recorrente: boolean;
    recorrenteMeses?: number;
    clienteId?: string | null;
  };

  const [confirmDup, setConfirmDup] = useState<null | {
    parecida: Receita;
    payload: NovaPayload;
  }>(null);

  const receita = isEdit ? props.receita : null;
  const showScope = !!(receita?.recorrente && receita?.recorrenciaId);

  async function persistNova(payload: NovaPayload) {
    if (!payload.recorrente && user?.id && !isOnline()) {
      try {
        await enqueueIncome(user.id, {
          descricao: payload.descricao,
          valor: payload.valor,
          data: payload.data,
          tipo: payload.tipo,
          recorrente: false,
          clienteId: payload.clienteId ?? null,
        });
        toast.success(t("toast.offlineSaved"));
        props.onDone();
        return;
      } catch (err) {
        console.error("[offline-income] enqueue failed", err);
        toast.error(t("toast.offlineSaveError"));
        return;
      }
    }
    try {
      await addReceita(payload);
      toast.success(t("toast.added"));
      props.onDone();
    } catch {
      // addReceita já exibiu toast.error (quota free_ads ou erro genérico).
    }
  }

  async function handleSaveCreate() {
    const valor = parseBRLInput(valorStr);
    const desc = descricao.trim();
    if (!valor || !desc) {
      toast.error(t("toast.fillFields"));
      return;
    }
    if (recorrente && !(await requireOnline())) return;
    const dt = new Date(data + "T12:00:00");
    const mesNova = dt.getMonth() + 1;
    const anoNova = dt.getFullYear();
    const descNorm = normalizeDescricao(desc);

    const parecida = receitas.find((r) => {
      if (r.mes !== mesNova || r.ano !== anoNova) return false;
      if (r.tipo !== tipo) return false;
      const rDesc = normalizeDescricao(r.descricao);
      const descMatch =
        rDesc === descNorm || rDesc.includes(descNorm) || descNorm.includes(rDesc);
      const valorMatch = Math.abs(r.valor - valor) <= Math.max(1, valor * 0.05);
      return descMatch && valorMatch;
    });

    const payload: NovaPayload = {
      descricao: desc,
      valor,
      data,
      tipo,
      recorrente,
      recorrenteMeses: recorrente ? meses : undefined,
      clienteId,
    };

    if (parecida) {
      setConfirmDup({ parecida, payload });
      return;
    }
    persistNova(payload);
  }

  async function handleSaveEdit() {
    if (!receita) return;
    const valor = parseBRLInput(valorStr);
    if (!valor || !descricao.trim()) {
      toast.error(t("toast.fillFields"));
      return;
    }
    if (!(await requireOnline())) return;
    updateReceita(
      receita.id,
      { descricao: descricao.trim(), valor, data, tipo, clienteId },
      showScope ? scope : "single",
    );
    toast.success(t("toast.updated"));
    props.onDone();
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-muted-foreground">{t("dialog.fields.descricao")}</Label>
        <Input
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder={isEdit ? undefined : t("dialog.fields.descricaoPlaceholder")}
          className="mt-1 h-11 bg-card-elevated"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">{t("dialog.fields.valor")}</Label>
          <Input
            inputMode="decimal"
            value={valorStr}
            onChange={(e) => setValorStr(e.target.value)}
            placeholder="0,00"
            className="num mt-1 h-11 bg-card-elevated"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">{t("dialog.fields.data")}</Label>
          <Input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="mt-1 h-11 bg-card-elevated"
          />
        </div>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">{t("dialog.fields.tipo")}</Label>
        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoReceita)}>
          <SelectTrigger className="mt-1 h-11 bg-card-elevated">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_RECEITA.map((tp) => (
              <SelectItem key={tp.id} value={tp.id}>{t(`tipo.${tp.id}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ClienteSelect
        value={clienteId}
        onChange={setClienteId}
        clientesAtivos={clientesAtivos}
      />

      {!isEdit && (
        <>
          <div className="flex items-center justify-between rounded-xl bg-card-elevated px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t("dialog.fields.repeat")}</p>
              <p className="text-xs text-muted-foreground">{t("dialog.fields.repeatHint")}</p>
            </div>
            <Switch checked={recorrente} onCheckedChange={setRecorrente} />
          </div>
          {recorrente && (
            <div>
              <Label className="text-xs text-muted-foreground">{t("dialog.fields.repeatMonths")}</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={meses}
                onChange={(e) => setMeses(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1 h-11 bg-card-elevated"
              />
            </div>
          )}
        </>
      )}

      {isEdit && showScope && (
        <div className="rounded-xl border border-border bg-card-elevated p-3">
          <p className="text-xs font-medium text-muted-foreground">
            {t("dialog.scopeTitle")}
          </p>
          <RadioGroup
            value={scope}
            onValueChange={(v) => setScope(v as UpdateReceitaScope)}
            className="mt-2 space-y-2"
          >
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="single" id="scope-single" className="mt-0.5" />
              <span>
                <span className="block font-medium">{t("dialog.scope.single")}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("dialog.scope.singleHint")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="forward" id="scope-forward" className="mt-0.5" />
              <span>
                <span className="block font-medium">{t("dialog.scope.forward")}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("dialog.scope.forwardHint")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="all" id="scope-all" className="mt-0.5" />
              <span>
                <span className="block font-medium">{t("dialog.scope.all")}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("dialog.scope.allHint")}
                </span>
              </span>
            </label>
          </RadioGroup>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("dialog.scopeDateNote")}
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={props.onCancel}>{t("dialog.cancel")}</Button>
        <Button onClick={isEdit ? handleSaveEdit : handleSaveCreate}>
          {isEdit ? t("dialog.saveEdit") : t("dialog.save")}
        </Button>
      </div>

      <AlertDialog
        open={!!confirmDup}
        onOpenChange={(o) => { if (!o) setConfirmDup(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("duplicate.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDup && (
                <Trans
                  i18nKey="renda:duplicate.body"
                  values={{
                    descricao: confirmDup.parecida.descricao,
                    valor: formatBRL(confirmDup.parecida.valor),
                  }}
                  components={[<strong />, <strong />]}
                />
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("duplicate.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmDup) return;
                const p = confirmDup.payload;
                setConfirmDup(null);
                void persistNova(p);
              }}
            >
              {t("duplicate.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
