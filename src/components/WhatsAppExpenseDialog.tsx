import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { addGasto, getCartoes, getCategorias, suggestCategory, useStore } from "@/lib/store";
import { parseWhatsAppExpenseMessage } from "@/lib/whatsappParser";
import { FORMAS_PAGAMENTO } from "@/lib/types";
import { formatBRL } from "@/lib/format";
import { CategoryIcon } from "./CategoryIcon";
import { useSubscriptionGuard } from "@/lib/subscription-guard";
import { requireOnline } from "@/lib/use-online-status";

const EXEMPLOS = [
  "Gastei R$ 26,00 na H Nunes Lanchonete hoje no Mercado Pago",
  "Spotify 19,90 assinatura Nubank",
  "Cobasi 221,13 pet cartão Mercado Pago 13/04",
];

const MODELO =
  "Valor: 89,90\nLocal: TotalPass\nCategoria: Assinaturas\nCartão: Mercado Pago\nData: 19/04";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
};

export function WhatsAppExpenseDialog({ open, onOpenChange, onSaved }: Props) {
  const { t, i18n } = useTranslation("gastos");
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
  const formaLabel = parsed?.formaPagamento ? t(`pagamento.${parsed.formaPagamento}`) : "—";
  // ensure FORMAS_PAGAMENTO stays imported (used elsewhere) – referenced for type narrow
  void FORMAS_PAGAMENTO;

  const altaConfianca = !!parsed && parsed.confianca >= 0.7 && parsed.valor > 0;
  const dateLocale = i18n.resolvedLanguage === "en" ? "en-US" : "pt-BR";

  function copiarModelo() {
    navigator.clipboard.writeText(MODELO);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  function usarExemplo(s: string) {
    setMensagem(s);
  }

  async function salvar() {
    if (!parsed || parsed.valor <= 0) {
      toast.error(t("whatsapp.errValor"));
      return;
    }
    if (!canWrite) {
      requireSubscription(t("whatsapp.errPlano"));
      return;
    }
    if (!(await requireOnline())) return;

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

    const cartaoSuffix = cartao ? t("whatsapp.okSalvoCartao", { nome: cartao.nome }) : "";
    toast.success(t("whatsapp.okSalvo"), {
      description:
        t("whatsapp.okSalvoDesc", { nome: parsed.nome, valor: formatBRL(parsed.valor) }) +
        cartaoSuffix,
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
              <DialogTitle>{t("whatsapp.title")}</DialogTitle>
              <DialogDescription className="text-xs">{t("whatsapp.desc")}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Textarea
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder={t("whatsapp.placeholder")}
              className="min-h-[96px] bg-card-elevated text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXEMPLOS.map((ex) => (
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

          {parsed && parsed.valor > 0 && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> {t("whatsapp.previa")}
                </span>
                <Badge
                  variant="outline"
                  className={
                    altaConfianca
                      ? "border-emerald-500/40 text-emerald-400"
                      : "border-amber-500/40 text-amber-400"
                  }
                >
                  {altaConfianca ? t("whatsapp.altaConf") : t("whatsapp.revisar")}
                </Badge>
              </div>

              <div className="flex items-baseline justify-between">
                <p className="text-lg font-semibold truncate">{parsed.nome}</p>
                <p className="num text-xl font-bold">{formatBRL(parsed.valor)}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-card-elevated px-2.5 py-2">
                  <p className="text-muted-foreground">{t("whatsapp.categoria")}</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {categoria && <CategoryIcon categoria={categoria} size="sm" />}
                    <span className="font-medium">{categoria?.nome ?? "—"}</span>
                  </div>
                </div>
                <div className="rounded-lg bg-card-elevated px-2.5 py-2">
                  <p className="text-muted-foreground">{t("whatsapp.pagamento")}</p>
                  <p className="mt-0.5 font-medium">{formaLabel}</p>
                </div>
                <div className="rounded-lg bg-card-elevated px-2.5 py-2">
                  <p className="text-muted-foreground">{t("whatsapp.data")}</p>
                  <p className="mt-0.5 font-medium num">
                    {new Date(parsed.data + "T00:00:00").toLocaleDateString(dateLocale)}
                  </p>
                </div>
                <div className="rounded-lg bg-card-elevated px-2.5 py-2">
                  <p className="text-muted-foreground">{t("whatsapp.cartao")}</p>
                  <p className="mt-0.5 font-medium truncate">
                    {cartao
                      ? cartao.nome
                      : parsed.cartaoNomeDetectado
                        ? t("whatsapp.naoCadastrado", { nome: parsed.cartaoNomeDetectado })
                        : "—"}
                  </p>
                </div>
                {parsed.parcelas && (
                  <div className="col-span-2 rounded-lg bg-card-elevated px-2.5 py-2">
                    <p className="text-muted-foreground">{t("whatsapp.parcelas")}</p>
                    <p className="mt-0.5 font-medium num">
                      {t("whatsapp.parcelasPreview", {
                        n: parsed.parcelas,
                        valor: formatBRL(parsed.valor / parsed.parcelas),
                      })}
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

          <div className="rounded-xl border border-dashed border-border bg-card/40 p-3 text-[11px] text-muted-foreground">
            {t("whatsapp.aviso")}
          </div>

          <button
            type="button"
            onClick={copiarModelo}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-xs hover:bg-card-elevated"
          >
            <span className="text-muted-foreground">{t("whatsapp.copiarModelo")}</span>
            {copiado ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("whatsapp.cancelar")}
          </Button>
          <Button
            onClick={salvar}
            disabled={!parsed || parsed.valor <= 0}
            className="bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            {altaConfianca ? t("whatsapp.salvar") : t("whatsapp.salvarMesmo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
