import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation, Trans } from "react-i18next";
import { Globe, ArrowRightLeft, Info, Plus, RefreshCw } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatBRL, parseBRLInput, toLocalISODate } from "@/lib/format";
import {
  useStore,
  getCartoes,
  getCategorias,
  addGasto,
} from "@/lib/store";
import { FORMAS_PAGAMENTO, type FormaPagamento } from "@/lib/types";
import { getEconomicRadar } from "@/lib/radar.functions";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

type Moeda = "USD" | "EUR";

interface Indicator {
  key: string;
  value: number;
  fetchedAt: string;
}

interface RadarResult {
  indicators: Indicator[];
  fetchedAt: string;
}

interface Props {
  cartaoIdInicial?: string;
  compact?: boolean;
}

export function CompraInternacionalCard({ cartaoIdInicial, compact }: Props) {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const cartoes = useStore(getCartoes);
  const categorias = useStore(getCategorias);
  const fetchRadar = useServerFn(getEconomicRadar);

  const [moeda, setMoeda] = useState<Moeda>("USD");
  const [valorMoeda, setValorMoeda] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cartaoId, setCartaoId] = useState(cartaoIdInicial ?? "");
  const [loading, setLoading] = useState(true);
  const [radar, setRadar] = useState<RadarResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchRadar()
      .then((r) => {
        if (alive) setRadar(r as RadarResult);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [fetchRadar]);

  const cotacao = useMemo(() => {
    if (!radar) return null;
    const key = moeda === "USD" ? "USD_BRL" : "EUR_BRL";
    return radar.indicators.find((i) => i.key === key) ?? null;
  }, [radar, moeda]);

  const valorNumMoeda = parseBRLInput(valorMoeda);
  const valorBRL =
    cotacao && Number.isFinite(valorNumMoeda) && valorNumMoeda > 0
      ? valorNumMoeda * cotacao.value
      : 0;
  const valorBRLComTaxas = valorBRL * 1.075;

  function handleRegistrar() {
    if (!user) {
      toast.error(t("compraInternacional.toast.needAuth"));
      return;
    }
    if (valorBRL <= 0) {
      toast.error(t("compraInternacional.toast.needValue"));
      return;
    }
    setConfirmOpen(true);
  }

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-4 shadow-sm",
        compact && "p-3",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">
            <Globe className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">{t("compraInternacional.title")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("compraInternacional.subtitle")}
            </p>
          </div>
        </div>
        {loading && (
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr]">
        <div className="space-y-1">
          <Label className="text-[11px]">{t("compraInternacional.currency")}</Label>
          <Select value={moeda} onValueChange={(v) => setMoeda(v as Moeda)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">{t("compraInternacional.items.USD")}</SelectItem>
              <SelectItem value="EUR">{t("compraInternacional.items.EUR")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]" htmlFor="ci-valor">
            {t("compraInternacional.valueIn", { moeda: t(`compraInternacional.currencyNames.${moeda}`) })}
          </Label>
          <Input
            id="ci-valor"
            inputMode="decimal"
            placeholder={t(`compraInternacional.placeholder.${moeda}`)}
            value={valorMoeda}
            onChange={(e) => setValorMoeda(e.target.value)}
            className="h-9"
          />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
        <div className="space-y-1">
          <Label className="text-[11px]" htmlFor="ci-desc">
            {t("compraInternacional.descLabel")}
          </Label>
          <Input
            id="ci-desc"
            placeholder={t("compraInternacional.descPlaceholder")}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">{t("compraInternacional.cardLabel")}</Label>
          <Select
            value={cartaoId || "__none__"}
            onValueChange={(v) => setCartaoId(v === "__none__" ? "" : v)}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder={t("compraInternacional.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("compraInternacional.none")}</SelectItem>
              {cartoes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-3 rounded-xl border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] text-muted-foreground">
              {t("compraInternacional.valueApprox")}
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {valorBRL > 0 ? formatBRL(valorBRL) : "—"}
            </p>
            {valorBRL > 0 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t("compraInternacional.withTaxes")}{" "}
                <strong className="tabular-nums">
                  {formatBRL(valorBRLComTaxas)}
                </strong>
              </p>
            )}
          </div>
          {cotacao && (
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">{t("compraInternacional.rate")}</p>
              <p className="text-sm font-medium tabular-nums">
                {formatBRL(cotacao.value)}
              </p>
              <p className="text-[10px] text-muted-foreground">{t("compraInternacional.per", { moeda })}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          <Trans
            i18nKey="compraInternacional.estimateNote"
            ns="dashboard"
            components={{ 1: <strong /> }}
          />
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={handleRegistrar}
          disabled={valorBRL <= 0}
          size="sm"
          className="rounded-full"
        >
          <Plus className="mr-1 h-4 w-4" />
          {t("compraInternacional.register")}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          <ArrowRightLeft className="mr-1 inline h-3 w-3" />
          {t("compraInternacional.notSaved")}
        </span>
      </div>

      <ConfirmRegistrarDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        moeda={moeda}
        valorOriginal={valorNumMoeda}
        valorBRLEstimado={valorBRLComTaxas > 0 ? valorBRLComTaxas : valorBRL}
        cotacao={cotacao?.value ?? 0}
        descricaoInicial={
          descricao ||
          t("compraInternacional.defaultDesc", {
            moeda,
            valor: valorNumMoeda ? valorNumMoeda.toFixed(2) : "",
          }).trim()
        }
        cartaoIdInicial={cartaoId}
        categorias={categorias}
        cartoes={cartoes}
        onSaved={() => {
          setConfirmOpen(false);
          setValorMoeda("");
          setDescricao("");
        }}
      />
    </div>
  );
}

function ConfirmRegistrarDialog({
  open,
  onOpenChange,
  moeda,
  valorOriginal,
  valorBRLEstimado,
  cotacao,
  descricaoInicial,
  cartaoIdInicial,
  categorias,
  cartoes,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  moeda: Moeda;
  valorOriginal: number;
  valorBRLEstimado: number;
  cotacao: number;
  descricaoInicial: string;
  cartaoIdInicial: string;
  categorias: Array<{ id: string; nome: string }>;
  cartoes: Array<{ id: string; nome: string }>;
  onSaved: () => void;
}) {
  const { t } = useTranslation("dashboard");
  const [descricao, setDescricao] = useState(descricaoInicial);
  const [valorBRL, setValorBRL] = useState(valorBRLEstimado.toFixed(2).replace(".", ","));
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>("credito");
  const [cartaoId, setCartaoId] = useState(cartaoIdInicial);
  const [categoriaId, setCategoriaId] = useState<string>("");
  const [data, setData] = useState<string>(toLocalISODate(new Date()));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDescricao(descricaoInicial);
    setValorBRL(valorBRLEstimado.toFixed(2).replace(".", ","));
    setCartaoId(cartaoIdInicial);
    setFormaPagamento(cartaoIdInicial ? "credito" : "credito");
    setData(toLocalISODate(new Date()));
  }, [open, descricaoInicial, valorBRLEstimado, cartaoIdInicial]);

  async function handleSalvar() {
    const valorNum = parseBRLInput(valorBRL);
    if (!descricao.trim() || valorNum <= 0) {
      toast.error(t("compraInternacional.toast.needFields"));
      return;
    }
    setSaving(true);
    try {
      const obs = t("compraInternacional.obs", {
        moeda,
        valor: valorOriginal.toFixed(2).replace(".", ","),
        cotacao: formatBRL(cotacao),
      });
      addGasto({
        descricao: descricao.trim(),
        estabelecimento: descricao.trim(),
        valor: valorNum,
        data,
        categoriaId: categoriaId || "outros",
        formaPagamento,
        cartaoId: formaPagamento === "credito" ? cartaoId || undefined : undefined,
        observacao: obs,
        origem: "radar_internacional",
      });
      toast.success(t("compraInternacional.toast.saved"));
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("compraInternacional.confirm.title")}</DialogTitle>
          <DialogDescription>
            {t("compraInternacional.confirm.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t("compraInternacional.confirm.desc")}</Label>
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder={t("compraInternacional.confirm.descPh")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("compraInternacional.confirm.valueBRL")}</Label>
              <Input
                value={valorBRL}
                onChange={(e) => setValorBRL(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div>
              <Label className="text-xs">{t("compraInternacional.confirm.date")}</Label>
              <Input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("compraInternacional.confirm.payment")}</Label>
              <Select
                value={formaPagamento}
                onValueChange={(v) => setFormaPagamento(v as FormaPagamento)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAS_PAGAMENTO.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("compraInternacional.confirm.card")}</Label>
              <Select
                value={cartaoId || "__none__"}
                onValueChange={(v) => setCartaoId(v === "__none__" ? "" : v)}
                disabled={formaPagamento !== "credito"}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("compraInternacional.confirm.noCardDash")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("compraInternacional.none")}</SelectItem>
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
            <Label className="text-xs">{t("compraInternacional.confirm.category")}</Label>
            <Select
              value={categoriaId || "__none__"}
              onValueChange={(v) => setCategoriaId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("compraInternacional.confirm.noCategory")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("compraInternacional.confirm.noCategory")}</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="rounded-lg bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
            <Trans
              i18nKey="compraInternacional.confirm.footer"
              ns="dashboard"
              values={{
                moeda,
                valor: valorOriginal.toFixed(2).replace(".", ","),
                cotacao: formatBRL(cotacao),
              }}
              components={{ 1: <strong />, 3: <strong /> }}
            />
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("compraInternacional.confirm.cancel")}
          </Button>
          <Button type="button" onClick={handleSalvar} disabled={saving}>
            {saving ? t("compraInternacional.confirm.saving") : t("compraInternacional.confirm.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
