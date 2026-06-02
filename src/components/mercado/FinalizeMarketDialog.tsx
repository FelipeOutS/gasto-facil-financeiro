/**
 * Modal de confirmação de mercado antes de finalizar uma compra
 * (Carrinho Inteligente ou Lista de compras).
 *
 * Pergunta ao usuário em qual mercado a compra foi realizada e oferece:
 *  - Selecionar entre mercados salvos
 *  - Adicionar novo mercado (navega para /mercado/meus-mercados)
 *  - Informar nome manualmente
 *
 * NÃO finaliza a compra — apenas devolve o nome do mercado escolhido
 * via `onConfirm(marketName)`. A finalização acontece no caller.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Plus, Star, Store } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMercadosLocais } from "@/lib/mercado/mercados-store";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pré-preenche o input manual (e seleciona chip se bater). */
  defaultMarketName?: string;
  /** Recebe o nome do mercado escolhido (já trimado, ≥1 char). */
  onConfirm: (marketName: string) => void | Promise<void>;
  /** Quando true, desabilita o botão confirmar. */
  submitting?: boolean;
};

export function FinalizeMarketDialog({
  open,
  onOpenChange,
  defaultMarketName,
  onConfirm,
  submitting,
}: Props) {
  const { t } = useTranslation("mercado");
  const mercados = useMercadosLocais();
  const [manualName, setManualName] = useState("");

  // Reset/prefill cada vez que o modal abre
  useEffect(() => {
    if (open) {
      setManualName((defaultMarketName ?? "").trim());
    }
  }, [open, defaultMarketName]);

  const normalizedSelected = manualName.trim().toLowerCase();
  const trimmed = manualName.trim();
  const canConfirm = trimmed.length > 0 && !submitting;

  const sorted = useMemo(
    () =>
      [...mercados].sort((a, b) => {
        const fa = a.favorito ? 1 : 0;
        const fb = b.favorito ? 1 : 0;
        if (fa !== fb) return fb - fa;
        return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
      }),
    [mercados],
  );

  function pick(nome: string) {
    setManualName(nome);
  }

  async function confirm() {
    if (!canConfirm) return;
    await onConfirm(trimmed);
  }

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
          {sorted.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("finalizeMarketDialog.savedLabel")}
              </p>
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto pr-1">
                {sorted.map((m) => {
                  const active =
                    normalizedSelected ===
                    m.nome.trim().toLowerCase();
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => pick(m.nome)}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors active:scale-[0.98]",
                        active
                          ? "border-brand/40 bg-brand-soft text-brand"
                          : "border-border/60 bg-card-elevated text-foreground hover:bg-card",
                      )}
                    >
                      {m.favorito && (
                        <Star
                          className="h-3 w-3 shrink-0 fill-current"
                          aria-hidden
                        />
                      )}
                      <span className="truncate">{m.nome}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-border/60 bg-card-elevated p-3 text-[12px] text-muted-foreground">
              {t("finalizeMarketDialog.emptySaved")}
            </p>
          )}

          <div>
            <label
              htmlFor="finalize-market-manual"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              {t("finalizeMarketDialog.manualLabel")}
            </label>
            <div className="flex items-center gap-2">
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
                className="block w-full min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
          </div>

          <Link
            to="/mercado/meus-mercados"
            onClick={() => onOpenChange(false)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card-elevated px-3 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-card active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("finalizeMarketDialog.addNew")}
          </Link>
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
