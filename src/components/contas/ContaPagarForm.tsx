import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Repeat } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  addContaAPagar,
  getCategorias,
  updateContaAPagar,
  updateContaRecorrencia,
  useStore,
} from "@/lib/store";
import type { ContaAPagar } from "@/lib/types";
import { FORMAS_PAGAMENTO, type FormaPagamento } from "@/lib/types";
import { ruleFromFrequencia } from "@/lib/recurrence-date";
import {
  RecurrenceIntervalField,
  type RecurrenceIntervalValue,
} from "@/components/RecurrenceIntervalField";
import { IntegerInput } from "@/components/ui/integer-input";
import { formatMonthYear, parseBRLInput, todayISO } from "@/lib/format";
import { useFornecedores } from "@/lib/fornecedores";
import { mesReferenciaOpcoes, ymFromDate } from "@/lib/mes-referencia";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type ContaPagarFormProps = {
  conta?: ContaAPagar;
  defaultDate?: string;
  onSaved: () => void;
  onCancel: () => void;
  /** When true, footer buttons stretch full width (mobile pages). */
  fullWidthActions?: boolean;
};

export function ContaPagarForm({
  conta,
  defaultDate,
  onSaved,
  onCancel,
  fullWidthActions = false,
}: ContaPagarFormProps) {
  const { t } = useTranslation("contas-a-pagar");
  const isEdit = !!conta;
  const isPaga = conta?.status === "pago";
  const categorias = useStore(() => getCategorias());

  const [nome, setNome] = useState(conta?.nome ?? "");
  const [valorStr, setValorStr] = useState(conta ? String(conta.valor).replace(".", ",") : "");
  const [dataVenc, setDataVenc] = useState(conta?.dataVencimento ?? defaultDate ?? todayISO());
  const [categoriaId, setCategoriaId] = useState<string>(conta?.categoriaId ?? "");
  const [observacao, setObservacao] = useState(conta?.observacao ?? "");
  const [mesReferencia, setMesReferencia] = useState<string>(() => {
    if (conta?.mesReferencia && /^\d{4}-\d{2}$/.test(conta.mesReferencia)) {
      return conta.mesReferencia;
    }
    const base = conta?.dataVencimento ?? defaultDate;
    if (base && /^\d{4}-\d{2}-\d{2}/.test(base)) return base.slice(0, 7);
    return ymFromDate();
  });
  const [recorrente, setRecorrente] = useState(conta?.recorrente ?? false);
  const [regra, setRegra] = useState<RecurrenceIntervalValue>(() => {
    if (conta?.recorrenciaIntervalo && conta?.recorrenciaUnidade) {
      return { interval: conta.recorrenciaIntervalo, unit: conta.recorrenciaUnidade };
    }
    return ruleFromFrequencia(conta?.frequenciaRecorrencia ?? "mensal");
  });
  const [ocorrencias, setOcorrencias] = useState(12);

  const [beneficiario, setBeneficiario] = useState(conta?.beneficiario ?? "");
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | "">(
    conta?.formaPagamento ?? "",
  );
  const [bancoEmissor, setBancoEmissor] = useState(conta?.bancoEmissor ?? "");
  const [codigoBoleto, setCodigoBoleto] = useState(conta?.codigoBoleto ?? "");
  const [codigoPix, setCodigoPix] = useState(conta?.codigoPix ?? "");
  const [chavePix, setChavePix] = useState(conta?.chavePix ?? "");
  const [fornecedorId, setFornecedorId] = useState<string>(conta?.fornecedorId ?? "");
  const { ativos: fornecedoresAtivos } = useFornecedores();
  const [mostrarExtras, setMostrarExtras] = useState(
    !!(
      conta?.beneficiario ||
      conta?.formaPagamento ||
      conta?.bancoEmissor ||
      conta?.codigoBoleto ||
      conta?.codigoPix ||
      conta?.chavePix ||
      conta?.fornecedorId
    ),
  );

  const [sincronizarGasto, setSincronizarGasto] = useState(true);

  const [editScopeFields, setEditScopeFields] = useState<
    null | Parameters<typeof updateContaAPagar>[1]
  >(null);

  function handleSave() {
    const valor = parseBRLInput(valorStr);
    if (!nome.trim()) {
      toast.error(t("form.errName"));
      return;
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error(t("form.errValue"));
      return;
    }
    if (!dataVenc) {
      toast.error(t("form.errDate"));
      return;
    }

    if (isEdit && conta) {
      const fields = {
        nome: nome.trim(),
        valor,
        dataVencimento: dataVenc,
        categoriaId: (categoriaId || null) as string | null,
        observacao: observacao.trim() || undefined,
        mesReferencia: /^\d{4}-\d{2}$/.test(mesReferencia) ? mesReferencia : null,
        beneficiario: beneficiario.trim() || null,
        formaPagamento: (formaPagamento || null) as FormaPagamento | null,
        bancoEmissor: bancoEmissor.trim() || null,
        codigoBoleto: codigoBoleto.trim() || null,
        codigoPix: codigoPix.trim() || null,
        chavePix: chavePix.trim() || null,
        fornecedorId: fornecedorId || null,
        atualizarGastoVinculado: isPaga ? sincronizarGasto : false,
      };
      if (conta.recorrente && conta.recorrenciaId) {
        setEditScopeFields(fields);
        return;
      }
      updateContaAPagar(conta.id, fields);
      toast.success(
        isPaga && sincronizarGasto ? t("form.toastUpdatedSync") : t("form.toastUpdated"),
      );
    } else {
      addContaAPagar({
        nome: nome.trim(),
        valor,
        dataVencimento: dataVenc,
        categoriaId: categoriaId || undefined,
        observacao: observacao.trim() || undefined,
        mesReferencia: /^\d{4}-\d{2}$/.test(mesReferencia) ? mesReferencia : undefined,
        recorrente,
        recorrenteIntervalo: recorrente ? regra.interval : undefined,
        recorrenteUnidade: recorrente ? regra.unit : undefined,
        recorrenteMeses: recorrente ? Math.max(1, ocorrencias || 12) : undefined,
        beneficiario: beneficiario.trim() || undefined,
        formaPagamento: (formaPagamento || undefined) as FormaPagamento | undefined,
        bancoEmissor: bancoEmissor.trim() || undefined,
        codigoBoleto: codigoBoleto.trim() || undefined,
        codigoPix: codigoPix.trim() || undefined,
        chavePix: chavePix.trim() || undefined,
        fornecedorId: fornecedorId || null,
      });
      toast.success(recorrente ? t("form.toastCreatedRec") : t("form.toastCreated"));
    }
    onSaved();
  }

  function applyEditScope(scope: "single" | "future" | "all") {
    if (!conta || !editScopeFields) return;
    updateContaAPagar(conta.id, editScopeFields);

    if (scope !== "single" && conta.recorrenciaId) {
      const propagatedFields = { ...editScopeFields };
      delete propagatedFields.atualizarGastoVinculado;
      updateContaRecorrencia(conta.recorrenciaId, propagatedFields, scope, conta.mes, conta.ano);
    }

    toast.success(
      scope === "all"
        ? t("scope.toastAll")
        : scope === "future"
          ? t("scope.toastFuture")
          : t("scope.toastSingle"),
    );
    setEditScopeFields(null);
    onSaved();
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="conta-nome">{t("form.name")}</Label>
          <Input
            id="conta-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={t("form.namePlaceholder")}
            autoFocus={!isEdit}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="conta-valor">{t("form.value")}</Label>
            <Input
              id="conta-valor"
              inputMode="decimal"
              value={valorStr}
              onChange={(e) => setValorStr(e.target.value)}
              placeholder="0,00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conta-data">{t("form.dueDate")}</Label>
            <Input
              id="conta-data"
              type="date"
              value={dataVenc}
              onChange={(e) => setDataVenc(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t("form.category")}</Label>
          <Select
            value={categoriaId || "_none"}
            onValueChange={(v) => setCategoriaId(v === "_none" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("form.select")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">{t("form.noCategory")}</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="conta-mes-ref">{t("form.monthRef")}</Label>
          <Select value={mesReferencia} onValueChange={setMesReferencia}>
            <SelectTrigger id="conta-mes-ref">
              <SelectValue placeholder={t("form.monthRefPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {mesReferenciaOpcoes(undefined, 12, 6).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{t("form.monthRefHint")}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="conta-obs">{t("form.obs")}</Label>
          <Textarea
            id="conta-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
            placeholder={t("form.obsPlaceholder")}
          />
        </div>

        <div className="rounded-xl border border-border bg-card-elevated/40 p-3">
          <button
            type="button"
            onClick={() => setMostrarExtras((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <div>
              <p className="text-sm font-medium">{t("form.moreDetails")}</p>
              <p className="text-[11px] text-muted-foreground">{t("form.moreDetailsHint")}</p>
            </div>
            <ChevronRight
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                mostrarExtras && "rotate-90",
              )}
            />
          </button>

          {mostrarExtras && (
            <div className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="conta-benef">{t("form.beneficiary")}</Label>
                <Input
                  id="conta-benef"
                  value={beneficiario}
                  onChange={(e) => setBeneficiario(e.target.value)}
                  placeholder={t("form.beneficiaryPlaceholder")}
                />
              </div>

              <div className="space-y-1.5">
                <Label>{t("form.supplier")}</Label>
                {fornecedoresAtivos.length > 0 ? (
                  <Select
                    value={fornecedorId || "_none"}
                    onValueChange={(v) => setFornecedorId(v === "_none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("form.noSupplier")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">{t("form.noSupplier")}</SelectItem>
                      {fornecedoresAtivos.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.apelido || f.nome_fantasia || f.razao_social || f.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    {t("form.noSuppliersTitle")}{" "}
                    <Link
                      to="/fornecedores"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {t("form.registerSupplier")}
                    </Link>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t("form.paymentMethod")}</Label>
                  <Select
                    value={formaPagamento || "_none"}
                    onValueChange={(v) =>
                      setFormaPagamento(v === "_none" ? "" : (v as FormaPagamento))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("form.select")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">—</SelectItem>
                      {FORMAS_PAGAMENTO.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="conta-banco">{t("form.issuingBank")}</Label>
                  <Input
                    id="conta-banco"
                    value={bancoEmissor}
                    onChange={(e) => setBancoEmissor(e.target.value)}
                    placeholder={t("form.issuingBankPlaceholder")}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="conta-boleto">{t("form.boletoCode")}</Label>
                <Textarea
                  id="conta-boleto"
                  value={codigoBoleto}
                  onChange={(e) => setCodigoBoleto(e.target.value)}
                  rows={2}
                  placeholder={t("form.boletoCodePlaceholder")}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="conta-pix-cc">{t("form.pixCopy")}</Label>
                <Textarea
                  id="conta-pix-cc"
                  value={codigoPix}
                  onChange={(e) => setCodigoPix(e.target.value)}
                  rows={2}
                  placeholder={t("form.pixCopyPlaceholder")}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="conta-chave">{t("form.pixKey")}</Label>
                <Input
                  id="conta-chave"
                  value={chavePix}
                  onChange={(e) => setChavePix(e.target.value)}
                  placeholder={t("form.pixKeyPlaceholder")}
                />
              </div>
            </div>
          )}
        </div>

        {!isEdit && (
          <div className="rounded-xl border border-border bg-card-elevated/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t("form.recurring")}</p>
                <p className="text-[11px] text-muted-foreground">{t("form.recurringHint")}</p>
              </div>
              <Switch checked={recorrente} onCheckedChange={setRecorrente} />
            </div>
            {recorrente && (
              <div className="mt-3 space-y-3">
                <RecurrenceIntervalField value={regra} onChange={setRegra} />
                <div className="space-y-1.5">
                  <Label htmlFor="conta-ocorrencias">{t("form.occurrences")}</Label>
                  <IntegerInput
                    id="conta-ocorrencias"
                    min={1}
                    max={999}
                    fallback={12}
                    value={ocorrencias}
                    onValueChange={setOcorrencias}
                    className="h-11 w-24 bg-card-elevated text-center"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t("form.occurrencesHint")}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {isEdit && isPaga && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("form.syncTitle")}</p>
                <p className="text-[11px] text-muted-foreground">{t("form.syncHint")}</p>
              </div>
              <Switch checked={sincronizarGasto} onCheckedChange={setSincronizarGasto} />
            </div>
          </div>
        )}
      </div>

      <div
        className={cn(
          "mt-5 flex gap-2",
          fullWidthActions ? "flex-col-reverse sm:flex-row sm:justify-end" : "justify-end",
        )}
      >
        <Button
          variant="outline"
          onClick={onCancel}
          className={cn(fullWidthActions && "min-h-11 sm:min-h-0")}
        >
          {t("form.cancel")}
        </Button>
        <Button onClick={handleSave} className={cn(fullWidthActions && "min-h-11 sm:min-h-0")}>
          {isEdit ? t("form.save") : t("form.create")}
        </Button>
      </div>

      <AlertDialog open={!!editScopeFields} onOpenChange={(o) => !o && setEditScopeFields(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="mb-2 inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
              <Repeat className="h-3.5 w-3.5" />
              {t("scope.badge")}
            </div>
            <AlertDialogTitle>{t("scope.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("scope.desc")}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => applyEditScope("single")}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
            >
              <p className="text-sm font-semibold">{t("scope.single")}</p>
              <p className="text-xs text-muted-foreground">
                {t("scope.singleHint", {
                  label: formatMonthYear(conta?.ano ?? 0, conta?.mes ?? 0),
                })}
              </p>
            </button>
            <button
              type="button"
              onClick={() => applyEditScope("future")}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
            >
              <p className="text-sm font-semibold">{t("scope.future")}</p>
              <p className="text-xs text-muted-foreground">{t("scope.futureHint")}</p>
            </button>
            <button
              type="button"
              onClick={() => applyEditScope("all")}
              className="w-full rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10"
            >
              <p className="text-sm font-semibold">{t("scope.all")}</p>
              <p className="text-xs text-muted-foreground">{t("scope.allHint")}</p>
            </button>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>{t("scope.cancel")}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
