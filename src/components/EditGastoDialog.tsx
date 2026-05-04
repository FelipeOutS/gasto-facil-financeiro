import { useEffect, useMemo, useState } from "react";
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
import {
  getCartoes,
  getCategorias,
  updateGasto,
  useStore,
} from "@/lib/store";
import { FORMAS_PAGAMENTO, type FormaPagamento } from "@/lib/types";
import type { Gasto } from "@/lib/types";
import { formatBRL, parseBRLInput, parseDateLocal, toLocalISODate } from "@/lib/format";
import { CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function EditGastoDialog({
  gasto,
  open,
  onOpenChange,
}: {
  gasto: Gasto | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<Gasto | null>(gasto);
  useEffect(() => {
    if (gasto) setSnapshot(gasto);
  }, [gasto]);

  const categorias = useStore(() => getCategorias());
  const cartoes = useStore(() => getCartoes());

  const [valorStr, setValorStr] = useState("");
  const [data, setData] = useState("");
  const [descricao, setDescricao] = useState("");
  const [estabelecimento, setEstabelecimento] = useState("");
  const [categoriaId, setCategoriaId] = useState<string>("");
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>("credito");
  const [cartaoId, setCartaoId] = useState<string | undefined>(undefined);
  const [observacao, setObservacao] = useState("");
  const [horario, setHorario] = useState("");
  const [invoiceMonth, setInvoiceMonth] = useState<string>("");

  // Initialize fields from snapshot whenever the dialog opens with a new gasto
  useEffect(() => {
    if (!snapshot || !open) return;
    setValorStr(snapshot.valor ? snapshot.valor.toFixed(2).replace(".", ",") : "");
    setData(snapshot.data ?? "");
    setDescricao(snapshot.descricao ?? "");
    setEstabelecimento(snapshot.estabelecimento ?? "");
    setCategoriaId(snapshot.categoriaId ?? categorias[0]?.id ?? "outros");
    setFormaPagamento((snapshot.formaPagamento as FormaPagamento) ?? "credito");
    setCartaoId(snapshot.cartaoId);
    setObservacao(snapshot.observacao ?? "");
    setHorario(snapshot.horario ?? "");
    setInvoiceMonth(snapshot.invoiceMonth ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.id, open]);

  const valor = parseBRLInput(valorStr);
  const valorPreview = useMemo(() => formatBRL(valor), [valor]);

  if (!snapshot) return null;

  function handleSave() {
    if (!snapshot) return;
    const nome = (descricao || estabelecimento).trim();
    if (!nome) {
      toast.error("Preencha o nome do gasto.");
      return;
    }
    if (!valor || valor <= 0 || !Number.isFinite(valor)) {
      toast.error("Informe um valor válido.");
      return;
    }
    const parsed = parseDateLocal(data);
    if (!parsed) {
      toast.error("Escolha uma data para o gasto.");
      return;
    }
    const dataNorm = toLocalISODate(parsed);

    try {
      updateGasto(snapshot.id, {
        descricao: nome,
        estabelecimento: estabelecimento.trim(),
        valor,
        data: dataNorm,
        categoriaId,
        formaPagamento,
        observacao: observacao.trim() || undefined,
        cartaoId: formaPagamento === "credito" ? cartaoId : undefined,
        horario: horario.trim() || undefined,
      });
      toast.success("Gasto atualizado com sucesso.");
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível atualizar o gasto. Tente novamente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "p-0 gap-0 overflow-hidden",
          "w-[calc(100vw-1.5rem)] sm:max-w-[640px] lg:max-w-[760px]",
          "max-h-[90vh] flex flex-col rounded-2xl",
        )}
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border text-left space-y-1">
          <DialogTitle className="text-xl font-semibold">Editar gasto</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Atualize os dados do gasto. As alterações refletem em todo o app.
          </DialogDescription>
        </DialogHeader>

        {/* Body (scroll) */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Valor */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <Label htmlFor="edit-valor" className="text-xs text-muted-foreground">
              Valor
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

          {/* Categoria */}
          <div>
            <Label className="text-xs text-muted-foreground">Categoria</Label>
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

          {/* Data + Forma de pagamento */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="edit-data" className="text-xs text-muted-foreground">
                Data
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
              <Label className="text-xs text-muted-foreground">Pagamento</Label>
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
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Horário (opcional) */}
          <div>
            <Label htmlFor="edit-horario" className="text-xs text-muted-foreground">
              Horário (opcional)
            </Label>
            <Input
              id="edit-horario"
              type="time"
              value={horario}
              onChange={(e) => setHorario(e.target.value)}
              className="mt-1 h-11 bg-card sm:max-w-[220px]"
            />
          </div>

          {/* Cartão */}
          {formaPagamento === "credito" && (
            <div className="rounded-2xl border border-border bg-card p-3">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CreditCard className="h-3.5 w-3.5" />
                Cartão
              </Label>
              {cartoes.length > 0 ? (
                <Select
                  value={cartaoId ?? ""}
                  onValueChange={(v) => setCartaoId(v || undefined)}
                >
                  <SelectTrigger className="mt-1.5 h-11 bg-card-elevated">
                    <SelectValue placeholder="Selecionar cartão (opcional)" />
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
                <p className="mt-2 text-xs text-muted-foreground">
                  Nenhum cartão cadastrado.
                </p>
              )}
            </div>
          )}

          {/* Estabelecimento */}
          <div>
            <Label htmlFor="edit-estab" className="text-xs text-muted-foreground">
              Estabelecimento
            </Label>
            <Input
              id="edit-estab"
              placeholder="Ex.: Mercado Assaí"
              value={estabelecimento}
              onChange={(e) => setEstabelecimento(e.target.value)}
              className="mt-1 h-11 bg-card"
            />
          </div>

          {/* Descrição */}
          <div>
            <Label htmlFor="edit-desc" className="text-xs text-muted-foreground">
              Descrição
            </Label>
            <Input
              id="edit-desc"
              placeholder="Detalhes do gasto"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="mt-1 h-11 bg-card"
            />
          </div>

          {/* Observação */}
          <div>
            <Label htmlFor="edit-obs" className="text-xs text-muted-foreground">
              Observação
            </Label>
            <Textarea
              id="edit-obs"
              placeholder="Opcional"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="mt-1 min-h-[72px] resize-none bg-card"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-background px-6 py-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-10"
          >
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} className="h-10 px-5 font-semibold">
            Salvar alterações
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
