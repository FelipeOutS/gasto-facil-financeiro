import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
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
import { getEconomicRadar } from "@/server/radar.functions";
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
  /** Pré-selecionar um cartão (ex.: dentro do detalhe de um cartão). */
  cartaoIdInicial?: string;
  /** Visual compacto para usar em locais com menos espaço. */
  compact?: boolean;
}

export function CompraInternacionalCard({ cartaoIdInicial, compact }: Props) {
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
  // estimativa com IOF (3,5%) + spread médio do cartão (~4%)
  const valorBRLComTaxas = valorBRL * 1.075;

  const cartaoSelecionado = cartoes.find((c) => c.id === cartaoId);

  function handleRegistrar() {
    if (!user) {
      toast.error("Entre na sua conta para registrar o gasto.");
      return;
    }
    if (valorBRL <= 0) {
      toast.error("Informe o valor da compra primeiro.");
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
            <h3 className="text-sm font-semibold">Compras internacionais</h3>
            <p className="text-xs text-muted-foreground">
              Estime o valor em reais antes de fechar a compra.
            </p>
          </div>
        </div>
        {loading && (
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr]">
        <div className="space-y-1">
          <Label className="text-[11px]">Moeda</Label>
          <Select value={moeda} onValueChange={(v) => setMoeda(v as Moeda)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">🇺🇸 Dólar (USD)</SelectItem>
              <SelectItem value="EUR">🇪🇺 Euro (EUR)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]" htmlFor="ci-valor">
            Valor em {moeda === "USD" ? "dólares" : "euros"}
          </Label>
          <Input
            id="ci-valor"
            inputMode="decimal"
            placeholder={moeda === "USD" ? "Ex: 19,90" : "Ex: 25,00"}
            value={valorMoeda}
            onChange={(e) => setValorMoeda(e.target.value)}
            className="h-9"
          />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
        <div className="space-y-1">
          <Label className="text-[11px]" htmlFor="ci-desc">
            Descrição (opcional)
          </Label>
          <Input
            id="ci-desc"
            placeholder="Ex: Assinatura, hospedagem…"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Cartão (opcional)</Label>
          <Select
            value={cartaoId || "__none__"}
            onValueChange={(v) => setCartaoId(v === "__none__" ? "" : v)}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecionar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Nenhum</SelectItem>
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
              Valor aproximado em reais
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {valorBRL > 0 ? formatBRL(valorBRL) : "—"}
            </p>
            {valorBRL > 0 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Com IOF + spread estimado:{" "}
                <strong className="tabular-nums">
                  {formatBRL(valorBRLComTaxas)}
                </strong>
              </p>
            )}
          </div>
          {cotacao && (
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">Cotação</p>
              <p className="text-sm font-medium tabular-nums">
                {formatBRL(cotacao.value)}
              </p>
              <p className="text-[10px] text-muted-foreground">por 1 {moeda}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Este valor é uma <strong>estimativa</strong>. O valor real na fatura
          depende do IOF, do spread e da cotação usada pelo cartão no dia da
          cobrança.
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
          Registrar como gasto
        </Button>
        <span className="text-[11px] text-muted-foreground">
          <ArrowRightLeft className="mr-1 inline h-3 w-3" />
          Nada é salvo até você confirmar.
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
          `Compra em ${moeda} ${valorNumMoeda ? valorNumMoeda.toFixed(2) : ""}`.trim()
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
      toast.error("Confira a descrição e o valor.");
      return;
    }
    setSaving(true);
    try {
      const obs = `Estimativa de compra em ${moeda} ${valorOriginal
        .toFixed(2)
        .replace(".", ",")} · cotação ${formatBRL(cotacao)} por 1 ${moeda}. Valor final pode variar com IOF, spread e cotação do cartão.`;
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
      toast.success("Gasto registrado como estimativa.");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar compra internacional</DialogTitle>
          <DialogDescription>
            Revise os dados antes de salvar. O valor final na fatura pode
            mudar conforme IOF, spread e cotação do cartão.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Descrição</Label>
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex: Assinatura Netflix"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Valor estimado (R$)</Label>
              <Input
                value={valorBRL}
                onChange={(e) => setValorBRL(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div>
              <Label className="text-xs">Data</Label>
              <Input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Forma de pagamento</Label>
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
              <Label className="text-xs">Cartão</Label>
              <Select
                value={cartaoId || "__none__"}
                onValueChange={(v) => setCartaoId(v === "__none__" ? "" : v)}
                disabled={formaPagamento !== "credito"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
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
            <Label className="text-xs">Categoria</Label>
            <Select
              value={categoriaId || "__none__"}
              onValueChange={(v) => setCategoriaId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sem categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem categoria</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="rounded-lg bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
            Valor original: <strong>{moeda} {valorOriginal.toFixed(2).replace(".", ",")}</strong>
            {" · "}Cotação usada: <strong>{formatBRL(cotacao)}</strong> por 1 {moeda}.
            Esta é uma estimativa — você pode editar o valor quando a fatura chegar.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSalvar} disabled={saving}>
            {saving ? "Salvando..." : "Salvar gasto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
