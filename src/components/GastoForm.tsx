import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CategoryIcon } from "./CategoryIcon";
import {
  getCartoes,
  getCategorias,
  suggestCategory,
  useStore,
  type NovoGastoInput,
} from "@/lib/store";
import { FORMAS_PAGAMENTO, type FormaPagamento, type TipoGasto } from "@/lib/types";
import { formatBRL, parseBRLInput, todayISO } from "@/lib/format";
import { mesReferenciaOpcoes, ymFromDate } from "@/lib/mes-referencia";
import {
  ChevronDown,
  ChevronUp,
  Repeat,
  Layers,
  CreditCard,
  CalendarDays,
  Store,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useFornecedores } from "@/lib/fornecedores";
import { usePlan } from "@/lib/use-plan";

export type GastoFormProps = {
  initial?: Partial<NovoGastoInput>;
  submitLabel?: string;
  onSubmit: (data: NovoGastoInput) => void;
};

export function GastoForm({ initial, submitLabel, onSubmit }: GastoFormProps) {
  const { t } = useTranslation("gastos");
  const { t: tCommon } = useTranslation("common");
  const { plan } = usePlan();
  const isFreeAds = plan === "free_ads";
  const categorias = useStore(() => getCategorias());
  const cartoes = useStore(() => getCartoes());

  const [valorStr, setValorStr] = useState(
    initial?.valor ? initial.valor.toFixed(2).replace(".", ",") : "",
  );
  const valor = parseBRLInput(valorStr);
  const [data, setData] = useState(initial?.data ?? todayISO());
  const [estabelecimento, setEstabelecimento] = useState(initial?.estabelecimento ?? "");
  const [descricao, setDescricao] = useState(initial?.descricao ?? "");
  const [categoriaId, setCategoriaId] = useState(
    initial?.categoriaId ?? categorias[0]?.id ?? "outros",
  );
  const userPickedCategoria = useRef(!!initial?.categoriaId);
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>(
    initial?.formaPagamento ?? "credito",
  );
  const [cartaoId, setCartaoId] = useState<string | undefined>(initial?.cartaoId);
  const [observacao, setObservacao] = useState(initial?.observacao ?? "");
  const [tipoGasto, setTipoGasto] = useState<TipoGasto>(initial?.tipoGasto ?? "unico");
  const [parcelas, setParcelas] = useState<number>(initial?.totalParcelas ?? 2);
  const [recorrenteMeses, setRecorrenteMeses] = useState<number>(initial?.recorrenteMeses ?? 12);
  const [gastoFixo, setGastoFixo] = useState<boolean>(initial?.gastoFixo ?? false);
  const [fornecedorId, setFornecedorId] = useState<string>(
    (initial as { fornecedorId?: string } | undefined)?.fornecedorId ?? "",
  );
  const { ativos: fornecedoresAtivos } = useFornecedores();
  const [essencial, setEssencial] = useState<boolean>(initial?.essencial ?? false);
  const [invoiceMonth, setInvoiceMonth] = useState<string>(
    initial?.invoiceMonth && /^\d{4}-\d{2}$/.test(initial.invoiceMonth)
      ? initial.invoiceMonth
      : ymFromDate(initial?.data ?? todayISO()),
  );
  const userPickedMes = useRef(!!initial?.invoiceMonth);
  useEffect(() => {
    if (userPickedMes.current) return;
    setInvoiceMonth(ymFromDate(data));
  }, [data]);
  const opcoesMes = useMemo(() => mesReferenciaOpcoes(data), [data]);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (userPickedCategoria.current) return;
    const txt = `${estabelecimento} ${descricao}`.trim();
    if (txt.length < 3) return;
    const sug = suggestCategory(txt);
    setCategoriaId((prev) => (prev === sug ? prev : sug));
  }, [estabelecimento, descricao]);

  const valid = valor > 0 && !!data && !!categoriaId;
  const valorPreview = useMemo(() => formatBRL(valor), [valor]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({
          valor,
          data,
          estabelecimento: estabelecimento.trim(),
          descricao: descricao.trim() || estabelecimento.trim(),
          categoriaId,
          formaPagamento,
          observacao: observacao.trim() || undefined,
          imagemUrl: initial?.imagemUrl,
          tipoGasto,
          totalParcelas: tipoGasto === "parcelado" ? parcelas : undefined,
          recorrenteMeses: tipoGasto === "recorrente" ? recorrenteMeses : undefined,
          gastoFixo: gastoFixo || tipoGasto === "recorrente",
          essencial,
          cartaoId: formaPagamento === "credito" ? cartaoId : undefined,
          invoiceMonth:
            invoiceMonth && /^\d{4}-\d{2}$/.test(invoiceMonth) ? invoiceMonth : undefined,
          fornecedorId: fornecedorId || null,
        });
      }}
      className="space-y-5"
    >
      <div className="rounded-3xl border border-border bg-card p-5">
        <Label htmlFor="valor" className="text-xs text-muted-foreground">
          {t("form.valor")}
        </Label>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-muted-foreground">R$</span>
          <Input
            id="valor"
            inputMode="decimal"
            placeholder="0,00"
            value={valorStr}
            onChange={(e) => setValorStr(e.target.value)}
            className="num h-14 border-0 bg-transparent p-0 text-4xl font-extrabold tracking-tight !ring-0 focus-visible:!ring-0"
          />
        </div>
        <p className="num mt-1 text-xs text-muted-foreground">{valorPreview}</p>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">{t("form.categoria")}</Label>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {categorias.map((c) => {
            const active = c.id === categoriaId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  userPickedCategoria.current = true;
                  setCategoriaId(c.id);
                }}
                className={cn(
                  "flex shrink-0 flex-col items-center gap-1 rounded-2xl border px-3 py-2 transition-all",
                  active
                    ? "border-foreground/40 bg-card-elevated"
                    : "border-border bg-card hover:bg-card-elevated",
                )}
              >
                <CategoryIcon categoria={c} size="sm" />
                <span className="text-[11px] font-medium">{c.nome}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="data" className="text-xs text-muted-foreground">
            {t("form.data")}
          </Label>
          <Input
            id="data"
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
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" />
          {t("form.mesRefLabel")}
        </Label>
        <Select
          value={invoiceMonth}
          onValueChange={(v) => {
            userPickedMes.current = true;
            setInvoiceMonth(v);
          }}
        >
          <SelectTrigger className="mt-1.5 h-11 bg-card-elevated">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opcoesMes.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t("form.mesRefHelp")}</p>
      </div>

      {formaPagamento === "credito" && (
        <div className="rounded-2xl border border-border bg-card p-3 animate-fade-in">
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5" />
            {t("form.escolhaCartao")}
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
                      {c.banco ? <span className="text-muted-foreground"> · {c.banco}</span> : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-card-elevated px-3 py-2">
              <p className="text-xs text-muted-foreground">{t("form.semCartoes")}</p>
              <Link
                to="/cartoes"
                search={{ abrir: undefined }}
                className="text-xs font-semibold text-brand hover:underline"
              >
                {t("form.cadastrarCartao")}
              </Link>
            </div>
          )}
        </div>
      )}

      <div>
        <Label htmlFor="estab" className="text-xs text-muted-foreground">
          {t("form.estabelecimento")}
        </Label>
        <Input
          id="estab"
          placeholder={t("form.estabelecimentoPh")}
          value={estabelecimento}
          onChange={(e) => setEstabelecimento(e.target.value)}
          className="mt-1 h-11 bg-card"
        />
      </div>

      <button
        type="button"
        onClick={() => setShowMore((s) => !s)}
        className="flex w-full items-center justify-between text-sm text-muted-foreground hover:text-foreground"
      >
        {t("form.maisDetalhes")}
        {showMore ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {showMore && (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
          <div>
            <Label htmlFor="desc" className="text-xs text-muted-foreground">
              {t("form.descricao")}
            </Label>
            <Input
              id="desc"
              placeholder={t("form.descricaoPh")}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="mt-1 h-11 bg-card-elevated"
            />
          </div>

          <div>
            <Label htmlFor="obs" className="text-xs text-muted-foreground">
              {t("form.observacao")}
            </Label>
            <Textarea
              id="obs"
              placeholder={t("form.observacaoPh")}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="mt-1 min-h-[70px] bg-card-elevated"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">{t("form.tipoGasto")}</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(
                [
                  { id: "unico", label: t("form.tipoUnico") },
                  { id: "parcelado", label: t("form.tipoParcelado"), icon: Layers },
                  { id: "recorrente", label: t("form.tipoRecorrente"), icon: Repeat },
                ] as const
              ).map((opt) => {
                const active = tipoGasto === opt.id;
                const Icon = "icon" in opt ? opt.icon : null;
                const blockedForFreeAds = isFreeAds && opt.id === "parcelado";
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      if (blockedForFreeAds) {
                        toast.error(tCommon("subscription.freeAdsQuota.parcelamentoBlocked"));
                        return;
                      }
                      setTipoGasto(opt.id);
                    }}
                    aria-disabled={blockedForFreeAds}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium",
                      active ? "border-foreground/40 bg-card-elevated" : "border-border bg-card",
                      blockedForFreeAds && "opacity-50",
                    )}
                  >
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {tipoGasto === "parcelado" && (
            <div>
              <Label className="text-xs text-muted-foreground">{t("form.parcelas")}</Label>
              <IntegerInput
                min={2}
                max={36}
                fallback={2}
                value={parcelas}
                onValueChange={setParcelas}
                className="mt-1 h-11 bg-card-elevated"
              />
              <p className="mt-1 text-xs text-muted-foreground num">
                {t("form.parcelasPreview", { n: parcelas, valor: formatBRL(valor / parcelas) })}
              </p>
            </div>
          )}
          {tipoGasto === "recorrente" && (
            <div>
              <Label className="text-xs text-muted-foreground">{t("form.repetirMeses")}</Label>
              <IntegerInput
                min={1}
                max={60}
                fallback={12}
                value={recorrenteMeses}
                onValueChange={setRecorrenteMeses}
                className="mt-1 h-11 bg-card-elevated"
              />

            </div>
          )}

          <div className="flex items-center justify-between rounded-xl bg-card-elevated px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t("form.gastoFixo")}</p>
              <p className="text-xs text-muted-foreground">{t("form.gastoFixoDesc")}</p>
            </div>
            <Switch checked={gastoFixo} onCheckedChange={setGastoFixo} />
          </div>
          <div className="flex items-center justify-between rounded-xl bg-card-elevated px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t("form.essencial")}</p>
              <p className="text-xs text-muted-foreground">{t("form.essencialDesc")}</p>
            </div>
            <Switch checked={essencial} onCheckedChange={setEssencial} />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Store className="h-3.5 w-3.5" />
              {t("form.fornecedor")}
            </Label>
            {fornecedoresAtivos.length > 0 ? (
              <Select
                value={fornecedorId || "_none"}
                onValueChange={(v) => setFornecedorId(v === "_none" ? "" : v)}
              >
                <SelectTrigger className="mt-1.5 h-11 bg-card-elevated">
                  <SelectValue placeholder={t("form.semFornecedor")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">{t("form.semFornecedor")}</SelectItem>
                  {fornecedoresAtivos.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.apelido || f.nome_fantasia || f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-card-elevated px-3 py-2">
                <p className="text-xs text-muted-foreground">{t("form.semFornecedores")}</p>
                <Link
                  to="/fornecedores"
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  {t("form.cadastrarFornecedor")}
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={!valid}
        className="h-14 w-full rounded-2xl text-base font-semibold shadow-elevated"
      >
        {submitLabel ?? t("form.salvarGasto")}
      </Button>
    </form>
  );
}
