import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Sparkles, Copy, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  addGasto,
  getCartoes,
  getCategorias,
  suggestCategory,
  useStore,
} from "@/lib/store";
import { parseWhatsAppExpenseMessage } from "@/lib/whatsappParser";
import { FORMAS_PAGAMENTO } from "@/lib/types";
import { formatBRL } from "@/lib/format";
import { CategoryIcon } from "./CategoryIcon";
import { useSubscriptionGuard } from "@/lib/subscription-guard";

const EXEMPLOS = [
  "Gastei R$ 26,00 na H Nunes Lanchonete hoje no Mercado Pago",
  "Spotify 19,90 assinatura Nubank",
  "Cobasi 221,13 pet cartão Mercado Pago 13/04",
  "Aluguel 950 pix moradia 25/04",
  "Notebook 2500 em 10x cartão Inter",
];

const MODELO =
  "Valor: 89,90\nLocal: TotalPass\nCategoria: Assinaturas\nCartão: Mercado Pago\nData: 19/04";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
};

export function WhatsAppExpenseDialog({ open, onOpenChange, onSaved }: Props) {
  const cartoes = useStore(() => getCartoes());
  const categorias = useStore(() => getCategorias());
  const { canWrite, requireSubscription } = useSubscriptionGuard();

  const [mensagem, setMensagem] = useState("");
  const [copiado, setCopiado] = useState(false);

  const parsed = useMemo(() => {
    if (!mensagem.trim()) return null;
    return parseWhatsAppExpenseMessage(mensagem, cartoes);
  }, [mensagem, cartoes]);

  const categoriaId = useMemo(() => {
    if (!parsed) return categorias[0]?.id ?? "outros";
    return suggestCategory(parsed.categoriaSugestao || parsed.nome);
  }, [parsed, categorias]);

  const categoria = categorias.find((c) => c.id === categoriaId);
  const cartao = parsed?.cartaoId ? cartoes.find((c) => c.id === parsed.cartaoId) : undefined;
  const formaLabel = FORMAS_PAGAMENTO.find((f) => f.id === parsed?.formaPagamento)?.label ?? "—";

  const altaConfianca = !!parsed && parsed.confianca >= 0.7 && parsed.valor > 0;

  function copiarModelo() {
    navigator.clipboard.writeText(MODELO);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  function usarExemplo(s: string) {
    setMensagem(s);
  }

  function salvar() {
    if (!parsed || parsed.valor <= 0) {
      toast.error("Não consegui identificar o valor da mensagem");
      return;
    }
    if (!canWrite) {
      requireSubscription("Para adicionar gastos, escolha um plano ativo.");
      return;
    }

    addGasto({
      valor: parsed.valor,
      data: parsed.data,
      estabelecimento: parsed.nome,
      descricao: parsed.nome,
      categoriaId,
      formaPagamento: parsed.formaPagamento,
      observacao: `WhatsApp: ${parsed.mensagemOriginal}`,
      tipoGasto: parsed.parcelas ? "parcelado" : "unico",
      totalParcelas: parsed.parcelas,
      cartaoId: parsed.formaPagamento === "credito" ? parsed.cartaoId : undefined,
      origem: "whatsapp",
    });

    toast.success("Gasto adicionado!", {
      description: `${parsed.nome} — ${formatBRL(parsed.valor)}${
        cartao ? ` no cartão ${cartao.nome}` : ""
      }`,
    });

    setMensagem("");
    onOpenChange(false);
    onSaved?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <MessageCircle className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle>Adicionar pelo WhatsApp</DialogTitle>
              <DialogDescription className="text-xs">
                Cole ou digite a mensagem. O app interpreta valor, cartão, data e categoria.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Campo mensagem */}
          <div>
            <Textarea
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder="Ex.: Gastei R$ 26,00 na H Nunes Lanchonete hoje no Mercado Pago"
              className="min-h-[96px] bg-card-elevated text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXEMPLOS.slice(0, 3).map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => usarExemplo(ex)}
                  className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-card-elevated hover:text-foreground"
                >
                  {ex.length > 38 ? ex.slice(0, 38) + "…" : ex}
                </button>
              ))}
            </div>
          </div>

          {/* Prévia */}
          {parsed && parsed.valor > 0 && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> Prévia
                </span>
                <Badge
                  variant="outline"
                  className={
                    altaConfianca
                      ? "border-emerald-500/40 text-emerald-400"
                      : "border-amber-500/40 text-amber-400"
                  }
                >
                  {altaConfianca ? "Alta confiança" : "Revisar"}
                </Badge>
              </div>

              <div className="flex items-baseline justify-between">
                <p className="text-lg font-semibold truncate">{parsed.nome}</p>
                <p className="num text-xl font-bold">{formatBRL(parsed.valor)}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-card-elevated px-2.5 py-2">
                  <p className="text-muted-foreground">Categoria</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {categoria && <CategoryIcon categoria={categoria} size="sm" />}
                    <span className="font-medium">{categoria?.nome ?? "—"}</span>
                  </div>
                </div>
                <div className="rounded-lg bg-card-elevated px-2.5 py-2">
                  <p className="text-muted-foreground">Pagamento</p>
                  <p className="mt-0.5 font-medium">{formaLabel}</p>
                </div>
                <div className="rounded-lg bg-card-elevated px-2.5 py-2">
                  <p className="text-muted-foreground">Data</p>
                  <p className="mt-0.5 font-medium num">
                    {new Date(parsed.data + "T00:00:00").toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <div className="rounded-lg bg-card-elevated px-2.5 py-2">
                  <p className="text-muted-foreground">Cartão</p>
                  <p className="mt-0.5 font-medium truncate">
                    {cartao
                      ? cartao.nome
                      : parsed.cartaoNomeDetectado
                        ? `${parsed.cartaoNomeDetectado} (não cadastrado)`
                        : "—"}
                  </p>
                </div>
                {parsed.parcelas && (
                  <div className="col-span-2 rounded-lg bg-card-elevated px-2.5 py-2">
                    <p className="text-muted-foreground">Parcelas</p>
                    <p className="mt-0.5 font-medium num">
                      {parsed.parcelas}x de {formatBRL(parsed.valor / parsed.parcelas)}
                    </p>
                  </div>
                )}
              </div>

              {parsed.notas.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/5 border border-amber-500/20 px-2.5 py-2 text-[11px] text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <ul className="space-y-0.5">
                    {parsed.notas.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Aviso de segurança + modelo */}
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-3 text-[11px] text-muted-foreground">
            🔒 Nunca envie número completo do cartão, CVV, senha ou dados bancários sensíveis.
            Use apenas nome do cartão, valor, categoria e data.
          </div>

          <button
            type="button"
            onClick={copiarModelo}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-xs hover:bg-card-elevated"
          >
            <span className="text-muted-foreground">Copiar modelo de mensagem</span>
            {copiado ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>

          <a
            href="/whatsapp"
            className="flex w-full items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-500/10"
          >
            <span>Configurar integração real (webhook)</span>
            <span aria-hidden>→</span>
          </a>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={salvar}
            disabled={!parsed || parsed.valor <= 0}
            className="bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            {altaConfianca ? "Salvar gasto" : "Salvar mesmo assim"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
