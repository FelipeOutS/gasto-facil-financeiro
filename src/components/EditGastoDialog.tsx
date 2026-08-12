import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { CategoryIcon } from "./CategoryIcon";
import { getCartoes, getCategorias, getGastos, updateGasto, useStore } from "@/lib/store";
import { requireOnline } from "@/lib/use-online-status";
import { FORMAS_PAGAMENTO, type FormaPagamento } from "@/lib/types";
import type { Gasto } from "@/lib/types";
import { formatBRL, parseBRLInput, parseDateLocal, toLocalISODate } from "@/lib/format";
import { CreditCard } from "lucide-react";
import { mesReferenciaOpcoes } from "@/lib/mes-referencia";
import { cn } from "@/lib/utils";
import { inferRuleFromISODates } from "@/lib/recurrence-date";
import { toast } from "sonner";

/**
 * Form de edição de gasto — corpo reutilizável.
 * Usado tanto pelo Dialog desktop quanto pela página mobile dedicada
 * `/gastos/$id/editar`. Mantém 100% da lógica de validação/salvamento.
 */
export function EditGastoForm({
  gasto,
  onDone,
  onCancel,
}: {
  gasto: Gasto;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("gastos");
  const { t: tCommon } = useTranslation("common");
  const categorias = useStore(() => getCategorias());
  const cartoes = useStore(() => getCartoes());

  /**
   * Recorrência da série (somente leitura): a regra não é persistida por
   * ocorrência, então é deduzida das datas já materializadas com o MESMO
   * motor de recorrência. Editar aqui altera apenas esta ocorrência —
   * o histórico das demais permanece intacto.
   */
  const serieGastos = useStore(() =>
    gasto.recorrenciaId ? getGastos().filter((g) => g.recorrenciaId === gasto.recorrenciaId) : [],
  );
  const serie = useMemo(() => {
    if (!gasto.recorrenciaId || serieGastos.length < 2) return null;
    const rule = inferRuleFromISODates(serieGastos.map((g) => g.data));
    return rule ? { rule, total: serieGastos.length } : null;
  }, [gasto.recorrenciaId, serieGastos]);

  const [valorStr, setValorStr] = useState(
    gasto.valor ? gasto.valor.toFixed(2).replace(".", ",") : "",
  );
  const [data, setData] = useState(gasto.data ?? "");
  const [descricao, setDescricao] = useState(gasto.descricao ?? "");
  const [estabelecimento, setEstabelecimento] = useState(gasto.estabelecimento ?? "");
  const [categoriaId, setCategoriaId] = useState<string>(
    gasto.categoriaId ?? categorias[0]?.id ?? "outros",
  );
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>(
    (gasto.formaPagamento as FormaPagamento) ?? "credito",
  );
  const [cartaoId, setCartaoId] = useState<string | undefined>(gasto.cartaoId);
  const [observacao, setObservacao] = useState(gasto.observacao ?? "");
  const [horario, setHorario] = useState(gasto.horario ?? "");
  const [invoiceMonth, setInvoiceMonth] = useState<string>(
    gasto.invoiceMonth && /^\d{4}-\d{2}$/.test(gasto.invoiceMonth)
      ? gasto.invoiceMonth
      : gasto.data
        ? gasto.data.slice(0, 7)
        : "",
  );

  const valor = parseBRLInput(valorStr);
  const valorPreview = useMemo(() => formatBRL(valor), [valor]);

  async function handleSave() {
    if (!(await requireOnline())) return;
    const nome = (descricao || estabelecimento).trim();
    if (!nome) {
      toast.error(t("form.editar.errNome"));
      return;
    }
    if (!valor || valor <= 0 || !Number.isFinite(valor)) {
      toast.error(t("form.editar.errValor"));
      return;
    }
    const parsed = parseDateLocal(data);
    if (!parsed) {
      toast.error(t("form.editar.errData"));
      return;
    }
    const dataNorm = toLocalISODate(parsed);

    try {
      updateGasto(gasto.id, {
        descricao: nome,
        estabelecimento: estabelecimento.trim(),
        valor,
        data: dataNorm,
        categoriaId,
        formaPagamento,
        observacao: observacao.trim() || undefined,
        cartaoId: formaPagamento === "credito" ? cartaoId : undefined,
        horario: horario.trim() || undefined,
        invoiceMonth: invoiceMonth && /^\d{4}-\d{2}$/.test(invoiceMonth) ? invoiceMonth : undefined,
      });
      toast.success(t("form.editar.ok"));
      onDone();
    } catch (e) {
      console.error(e);
      toast.error(t("form.editar.err"));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
        {serie && (
          <div className="rounded-2xl border border-border bg-card-elevated/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {tCommon("recurrence.everyLabel")}
            </p>
            <p className="mt-1 text-sm font-medium">
              {tCommon("recurrence.every")} {serie.rule.interval}{" "}
              {tCommon(`recurrence.unit.${serie.rule.unit}`, { count: serie.rule.interval })} ·{" "}
              {tCommon("recurrence.preview.total", { count: serie.total })}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("form.editar.serieHint")}
            </p>
          </div>
        )}
        <div className="rounded-2xl border border-border bg-card p-4">

          <Label htmlFor="edit-valor" className="text-xs text-muted-foreground">
            {t("form.valor")}
          </Label>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold text-muted-foreground">R$</span>
            <Input
              id="edit-valor"
              inputMode="decimal"
              placeholder="0,00"
              value={valorStr}
              onChange={(e) => setValorStr(e.target.value)}
              className="num h-12 border-0 bg-transparent p-0 text-3xl font-extrabold tracking-tight !ring-0 focus-visible:!ring-0"
            />
          </div>
          <p className="num mt-1 text-xs text-muted-foreground">{valorPreview}</p>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">{t("form.categoria")}</Label>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {categorias.map((c) => {
              const active = c.id === categoriaId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoriaId(c.id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-all",
                    active
                      ? "border-foreground/40 bg-card-elevated ring-1 ring-foreground/20"
                      : "border-border bg-card hover:bg-card-elevated",
                  )}
                >
                  <CategoryIcon categoria={c} size="sm" />
                  <span className="line-clamp-1 text-[11px] font-medium">{c.nome}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="edit-data" className="text-xs text-muted-foreground">
              {t("form.data")}
            </Label>
            <Input
              id="edit-data"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="mt-1 h-11 bg-card"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("form.pagamento")}</Label>
            <Select
              value={formaPagamento}
              onValueChange={(v) => setFormaPagamento(v as FormaPagamento)}
            >
              <SelectTrigger className="mt-1 h-11 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMAS_PAGAMENTO.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {t(`pagamento.${f.id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-3">
          <Label htmlFor="edit-invoice" className="text-xs text-muted-foreground">
            {t("form.mesRefLabel")}
          </Label>
          <Select value={invoiceMonth} onValueChange={setInvoiceMonth}>
            <SelectTrigger className="mt-1.5 h-11 bg-card-elevated sm:max-w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mesReferenciaOpcoes(data || undefined).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{t("form.mesRefHelp")}</p>
        </div>

        <div>
          <Label htmlFor="edit-horario" className="text-xs text-muted-foreground">
            {t("form.editar.horario")}
          </Label>
          <Input
            id="edit-horario"
            type="time"
            value={horario}
            onChange={(e) => setHorario(e.target.value)}
            className="mt-1 h-11 bg-card sm:max-w-[220px]"
          />
        </div>

        {formaPagamento === "credito" && (
          <div className="rounded-2xl border border-border bg-card p-3">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CreditCard className="h-3.5 w-3.5" />
              {t("form.editar.cartao")}
            </Label>
            {cartoes.length > 0 ? (
              <Select value={cartaoId ?? ""} onValueChange={(v) => setCartaoId(v || undefined)}>
                <SelectTrigger className="mt-1.5 h-11 bg-card-elevated">
                  <SelectValue placeholder={t("form.selecionarCartao")} />
                </SelectTrigger>
                <SelectContent>
                  {cartoes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ background: c.cor }}
                        />
                        {c.nome}
                        {c.banco ? (
                          <span className="text-muted-foreground"> · {c.banco}</span>
                        ) : null}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{t("form.editar.nenhumCartao")}</p>
            )}
          </div>
        )}

        <div>
          <Label htmlFor="edit-estab" className="text-xs text-muted-foreground">
            {t("form.estabelecimento")}
          </Label>
          <Input
            id="edit-estab"
            placeholder={t("form.estabelecimentoPh")}
            value={estabelecimento}
            onChange={(e) => setEstabelecimento(e.target.value)}
            className="mt-1 h-11 bg-card"
          />
        </div>

        <div>
          <Label htmlFor="edit-desc" className="text-xs text-muted-foreground">
            {t("form.descricao")}
          </Label>
          <Input
            id="edit-desc"
            placeholder={t("form.descricaoPh")}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="mt-1 h-11 bg-card"
          />
        </div>

        <div>
          <Label htmlFor="edit-obs" className="text-xs text-muted-foreground">
            {t("form.observacao")}
          </Label>
          <Textarea
            id="edit-obs"
            placeholder={t("form.observacaoPh")}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="mt-1 min-h-[72px] resize-none bg-card"
          />
        </div>
      </div>

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:px-6">
        <Button type="button" variant="ghost" onClick={onCancel} className="h-11">
          {t("form.editar.cancelar")}
        </Button>
        <Button type="button" onClick={handleSave} className="h-11 px-5 font-semibold">
          {t("form.editar.salvar")}
        </Button>
      </div>
    </div>
  );
}

export function EditGastoDialog({
  gasto,
  open,
  onOpenChange,
}: {
  gasto: Gasto | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation("gastos");
  // Snapshot para evitar perder os valores se `gasto` virar null durante a animação de fechar.
  const [snapshot, setSnapshot] = useState<Gasto | null>(gasto);
  useEffect(() => {
    if (gasto) setSnapshot(gasto);
  }, [gasto]);

  if (!snapshot) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "p-0 gap-0 overflow-hidden",
          "w-[calc(100vw-1.5rem)] sm:max-w-[640px] lg:max-w-[760px]",
          "max-h-[90vh] flex flex-col rounded-2xl",
        )}
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border text-left space-y-1">
          <DialogTitle className="text-xl font-semibold">{t("form.editar.title")}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("form.editar.desc")}
          </DialogDescription>
        </DialogHeader>

        <EditGastoForm
          key={snapshot.id}
          gasto={snapshot}
          onDone={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
