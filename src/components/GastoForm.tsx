import { useEffect, useMemo, useRef, useState } from "react";
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
import { ChevronDown, ChevronUp, Repeat, Layers, CreditCard, CalendarDays } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type GastoFormProps = {
  initial?: Partial<NovoGastoInput>;
  submitLabel?: string;
  onSubmit: (data: NovoGastoInput) => void;
};

export function GastoForm({ initial, submitLabel = "Salvar gasto", onSubmit }: GastoFormProps) {
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
  // Tracks whether the user manually picked a category — once true, never auto-replace.
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
  const [essencial, setEssencial] = useState<boolean>(initial?.essencial ?? false);
  const [invoiceMonth, setInvoiceMonth] = useState<string>(
    initial?.invoiceMonth && /^\d{4}-\d{2}$/.test(initial.invoiceMonth)
      ? initial.invoiceMonth
      : ymFromDate(initial?.data ?? todayISO()),
  );
  const userPickedMes = useRef(!!initial?.invoiceMonth);
  // Quando o usuário muda a data, sugerir mês de referência (sem sobrescrever escolha manual)
  useEffect(() => {
    if (userPickedMes.current) return;
    setInvoiceMonth(ymFromDate(data));
  }, [data]);
  const opcoesMes = useMemo(() => mesReferenciaOpcoes(data), [data]);
  const [showMore, setShowMore] = useState(false);

  // Suggest category when user types in establishment/description (only if not user-picked)
  useEffect(() => {
    if (userPickedCategoria.current) return;
    const t = `${estabelecimento} ${descricao}`.trim();
    if (t.length < 3) return;
    const sug = suggestCategory(t);
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
        });
      }}
      className="space-y-5"
    >
      {/* Valor card */}
      <div className="rounded-3xl border border-border bg-card p-5">
        <Label htmlFor="valor" className="text-xs text-muted-foreground">
          Valor
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

      {/* Categoria */}
      <div>
        <Label className="text-xs text-muted-foreground">Categoria</Label>
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

      {/* Quick fields */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="data" className="text-xs text-muted-foreground">
            Data
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
          <Label className="text-xs text-muted-foreground">Pagamento</Label>
          <Select value={formaPagamento} onValueChange={(v) => setFormaPagamento(v as FormaPagamento)}>
            <SelectTrigger className="mt-1 h-11 bg-card">
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
      </div>

      {formaPagamento === "credito" && (
        <div className="rounded-2xl border border-border bg-card p-3 animate-fade-in">
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5" />
            Escolha o cartão
          </Label>
          {cartoes.length > 0 ? (
            <Select value={cartaoId ?? ""} onValueChange={(v) => setCartaoId(v || undefined)}>
              <SelectTrigger className="mt-1.5 h-11 bg-card-elevated">
                <SelectValue placeholder="Selecionar cartão (opcional)" />
              </SelectTrigger>
              <SelectContent>
                {cartoes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: c.cor }} />
                      {c.nome}
                      {c.banco ? <span className="text-muted-foreground"> · {c.banco}</span> : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-card-elevated px-3 py-2">
              <p className="text-xs text-muted-foreground">Você ainda não tem cartões cadastrados.</p>
              <Link to="/cartoes" search={{ abrir: undefined }} className="text-xs font-semibold text-brand hover:underline">
                Cadastrar cartão
              </Link>
            </div>
          )}
        </div>
      )}

      <div>
        <Label htmlFor="estab" className="text-xs text-muted-foreground">
          Estabelecimento
        </Label>
        <Input
          id="estab"
          placeholder="Ex.: Mercado Assaí"
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
        Mais detalhes
        {showMore ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {showMore && (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
          <div>
            <Label htmlFor="desc" className="text-xs text-muted-foreground">
              Descrição
            </Label>
            <Input
              id="desc"
              placeholder="Detalhes do gasto"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="mt-1 h-11 bg-card-elevated"
            />
          </div>

          <div>
            <Label htmlFor="obs" className="text-xs text-muted-foreground">
              Observação
            </Label>
            <Textarea
              id="obs"
              placeholder="Opcional"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="mt-1 min-h-[70px] bg-card-elevated"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Tipo de gasto</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(
                [
                  { id: "unico", label: "Único" },
                  { id: "parcelado", label: "Parcelado", icon: Layers },
                  { id: "recorrente", label: "Recorrente", icon: Repeat },
                ] as const
              ).map((opt) => {
                const active = tipoGasto === opt.id;
                const Icon = "icon" in opt ? opt.icon : null;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTipoGasto(opt.id)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium",
                      active
                        ? "border-foreground/40 bg-card-elevated"
                        : "border-border bg-card",
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
              <Label className="text-xs text-muted-foreground">Parcelas</Label>
              <Input
                type="number"
                min={2}
                max={36}
                value={parcelas}
                onChange={(e) => setParcelas(Math.max(2, Number(e.target.value) || 2))}
                className="mt-1 h-11 bg-card-elevated"
              />
              <p className="mt-1 text-xs text-muted-foreground num">
                {parcelas}x de {formatBRL(valor / parcelas)}
              </p>
            </div>
          )}
          {tipoGasto === "recorrente" && (
            <div>
              <Label className="text-xs text-muted-foreground">Repetir por (meses)</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={recorrenteMeses}
                onChange={(e) => setRecorrenteMeses(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1 h-11 bg-card-elevated"
              />
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl bg-card-elevated px-3 py-2">
            <div>
              <p className="text-sm font-medium">Gasto fixo</p>
              <p className="text-xs text-muted-foreground">Conta mensal recorrente</p>
            </div>
            <Switch checked={gastoFixo} onCheckedChange={setGastoFixo} />
          </div>
          <div className="flex items-center justify-between rounded-xl bg-card-elevated px-3 py-2">
            <div>
              <p className="text-sm font-medium">Essencial</p>
              <p className="text-xs text-muted-foreground">Aluguel, contas, alimentação base…</p>
            </div>
            <Switch checked={essencial} onCheckedChange={setEssencial} />
          </div>
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={!valid}
        className="h-14 w-full rounded-2xl text-base font-semibold shadow-elevated"
      >
        {submitLabel}
      </Button>
    </form>
  );
}
