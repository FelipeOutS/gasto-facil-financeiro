/**
 * Modal de confirmação de compra do Mercado Inteligente.
 *
 * Pergunta ao usuário:
 *  - Em qual mercado a compra foi realizada;
 *  - Forma de pagamento (Pix, Dinheiro, Débito, Crédito, Outro);
 *  - Quando débito/crédito: cartão usado (se houver cadastrado).
 *
 * NÃO finaliza a compra — devolve a escolha via `onConfirm({ ... })`.
 * A persistência (histórico, preço comunitário, gasto, cartão) é do caller.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { CreditCard, Plus, Star, Store } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMercadosLocais } from "@/lib/mercado/mercados-store";
import { getCartoes, useStore } from "@/lib/store";
import type { FormaPagamento } from "@/lib/types";
import { cn } from "@/lib/utils";

export type FinalizeMarketDialogResult = {
  marketName: string;
  formaPagamento: FormaPagamento;
  cartaoId?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pré-preenche o input de mercado. */
  defaultMarketName?: string;
  /** Pré-preenche a forma de pagamento. */
  defaultFormaPagamento?: FormaPagamento;
  /** Total estimado da compra (apenas exibição). */
  totalEstimado?: number;
  /** Quantos itens estão sem preço (apenas exibição como aviso). */
  itensSemPreco?: number;
  /** Recebe a escolha completa. */
  onConfirm: (result: FinalizeMarketDialogResult) => void | Promise<void>;
  /** Desabilita o botão confirmar enquanto submetendo. */
  submitting?: boolean;
};

const PAGAMENTOS: Array<{ id: FormaPagamento; key: string }> = [
  { id: "pix", key: "pix" },
  { id: "dinheiro", key: "dinheiro" },
  { id: "debito", key: "debito" },
  { id: "credito", key: "credito" },
  { id: "outro", key: "outro" },
];

export function FinalizeMarketDialog({
  open,
  onOpenChange,
  defaultMarketName,
  defaultFormaPagamento,
  totalEstimado,
  itensSemPreco,
  onConfirm,
  submitting,
}: Props) {
  const { t } = useTranslation("mercado");
  const mercados = useMercadosLocais();
  const cartoes = useStore(() => getCartoes());

  const [manualName, setManualName] = useState("");
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>(
    defaultFormaPagamento ?? "pix",
  );
  const [cartaoId, setCartaoId] = useState<string>("");

  // Reset/prefill cada vez que o modal abre
  useEffect(() => {
    if (open) {
      setManualName((defaultMarketName ?? "").trim());
      setFormaPagamento(defaultFormaPagamento ?? "pix");
      setCartaoId("");
    }
  }, [open, defaultMarketName, defaultFormaPagamento]);

  const normalizedSelected = manualName.trim().toLowerCase();
  const trimmed = manualName.trim();
  const isCardPayment = formaPagamento === "credito" || formaPagamento === "debito";
  const canConfirm = trimmed.length > 0 && !submitting;

  const sortedMercados = useMemo(
    () =>
      [...mercados].sort((a, b) => {
        const fa = a.favorito ? 1 : 0;
        const fb = b.favorito ? 1 : 0;
        if (fa !== fb) return fb - fa;
        return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
      }),
    [mercados],
  );

  function pickMercado(nome: string) {
    setManualName(nome);
  }

  async function confirm() {
    if (!canConfirm) return;
    await onConfirm({
      marketName: trimmed,
      formaPagamento,
      cartaoId: isCardPayment && cartaoId ? cartaoId : undefined,
    });
  }

  const totalFmt =
    typeof totalEstimado === "number" && Number.isFinite(totalEstimado) && totalEstimado > 0
      ? totalEstimado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("finalizeMarketDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("finalizeMarketDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {(totalFmt || (itensSemPreco ?? 0) > 0) && (
            <div className="rounded-2xl border border-border/60 bg-card-elevated p-3 text-[12px] text-muted-foreground">
              {totalFmt && (
                <p>
                  <span className="font-semibold text-foreground">
                    {t("finalizeMarketDialog.totalLabel")}:
                  </span>{" "}
                  <span className="tabular-nums">{totalFmt}</span>
                </p>
              )}
              {(itensSemPreco ?? 0) > 0 && (
                <p className="mt-1">
                  {t("finalizeMarketDialog.missingPriceWarning", {
                    count: itensSemPreco ?? 0,
                  })}
                </p>
              )}
            </div>
          )}

          {/* Mercado */}
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("finalizeMarketDialog.marketSection")}
            </p>
            {sortedMercados.length > 0 ? (
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pr-1">
                {sortedMercados.map((m) => {
                  const active = normalizedSelected === m.nome.trim().toLowerCase();
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => pickMercado(m.nome)}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors active:scale-[0.98]",
                        active
                          ? "border-brand/40 bg-brand-soft text-brand"
                          : "border-border/60 bg-card-elevated text-foreground hover:bg-card",
                      )}
                    >
                      {m.favorito && (
                        <Star className="h-3 w-3 shrink-0 fill-current" aria-hidden />
                      )}
                      <span className="truncate">{m.nome}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-border/60 bg-card-elevated p-3 text-[12px] text-muted-foreground">
                {t("finalizeMarketDialog.emptySaved")}
              </p>
            )}

            <div className="mt-2 flex items-center gap-2">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card-elevated text-muted-foreground">
                <Store className="h-4 w-4" aria-hidden />
              </span>
              <input
                id="finalize-market-manual"
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                maxLength={80}
                placeholder={t("finalizeMarketDialog.manualPlaceholder")}
                aria-label={t("finalizeMarketDialog.manualLabel")}
                className="block w-full min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>

            <Link
              to="/mercado/meus-mercados"
              onClick={() => onOpenChange(false)}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card-elevated px-3 py-2 text-[12px] font-semibold text-foreground transition-colors hover:bg-card active:scale-[0.98]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t("finalizeMarketDialog.addNew")}
            </Link>
          </div>

          {/* Pagamento */}
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("finalizeMarketDialog.paymentSection")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PAGAMENTOS.map((p) => {
                const active = formaPagamento === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setFormaPagamento(p.id)}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors active:scale-[0.98]",
                      active
                        ? "border-brand/40 bg-brand-soft text-brand"
                        : "border-border/60 bg-card-elevated text-foreground hover:bg-card",
                    )}
                  >
                    {t(`finalizeMarketDialog.payment.${p.key}`)}
                  </button>
                );
              })}
            </div>

            {isCardPayment && (
              <div className="mt-3">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("finalizeMarketDialog.cardLabel")}
                </label>
                {cartoes.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card-elevated text-muted-foreground">
                      <CreditCard className="h-4 w-4" aria-hidden />
                    </span>
                    <select
                      value={cartaoId}
                      onChange={(e) => setCartaoId(e.target.value)}
                      className="block w-full min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      <option value="">
                        {t("finalizeMarketDialog.cardNone")}
                      </option>
                      {cartoes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                          {c.bandeira ? ` · ${c.bandeira}` : ""}
                          {c.final ? ` · ${c.final}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-border/60 bg-card-elevated p-3 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <span>{t("finalizeMarketDialog.cardEmpty")}</span>
                    <Link
                      to="/cartoes/novo"
                      onClick={() => onOpenChange(false)}
                      className="inline-flex min-h-9 items-center justify-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-card-elevated active:scale-[0.98]"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      {t("finalizeMarketDialog.cardAdd")}
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-card active:scale-[0.98] disabled:opacity-60"
          >
            {t("finalizeMarketDialog.cancel")}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!canConfirm}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand-grad px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-elevated transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-60"
          >
            {t("finalizeMarketDialog.confirm")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
