import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Plus, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntegerInput } from "@/components/ui/integer-input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { getAutomaticCardColor, getCardTheme } from "@/lib/card-theme";
import { getCardIdentity } from "@/lib/card-identity";
import { getExactBankSlug } from "@/lib/bank-aliases";
import { formatBRL, parseBRLInput } from "@/lib/format";
import { validarCartao } from "@/lib/cartao-validacao";
import { addCartao, updateCartao, type NovoCartaoInput } from "@/lib/store";
import { requireOnline } from "@/lib/use-online-status";
import type { Cartao } from "@/lib/types";
import { EMISSORES_CARTAO_PADRAO } from "@/lib/types";
import { cn } from "@/lib/utils";

const BANK_OPTIONS = [
  ...EMISSORES_CARTAO_PADRAO.filter((option) => option.nome !== "Outro"),
  { nome: "Neon", cor: "#00d563" },
];

function normalizeBankSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/^cartao\s+/, "");
}

/**
 * Formulário de cartão reutilizável — usado pelo Dialog (desktop) e pela
 * rota dedicada /cartoes/novo (mobile/Android WebView, sem modal).
 * Não altera nenhuma regra de negócio: usa exatamente as mesmas funções
 * addCartao / updateCartao do store.
 */
export function CartaoForm({
  editing,
  onCancel,
  onSaved,
  footerClassName,
  pageLayout = false,
}: {
  editing: Cartao | null;
  onCancel: () => void;
  onSaved: () => void;
  footerClassName?: string;
  pageLayout?: boolean;
}) {
  const { t } = useTranslation("cartoes");
  const [nome, setNome] = useState(editing?.nome ?? "");
  const [banco, setBanco] = useState(editing?.banco ?? "");
  const [limiteStr, setLimiteStr] = useState(
    editing ? editing.limiteTotal.toFixed(2).replace(".", ",") : "",
  );
  const [diaFech, setDiaFech] = useState<number>(editing?.diaFechamento ?? 1);
  const [diaVenc, setDiaVenc] = useState<number>(editing?.diaVencimento ?? 10);
  const [obs, setObs] = useState(editing?.observacao ?? "");
  const [showObs, setShowObs] = useState(Boolean(editing?.observacao));
  const [closingTouched, setClosingTouched] = useState(Boolean(editing));
  const [dueTouched, setDueTouched] = useState(Boolean(editing));
  const [bankOpen, setBankOpen] = useState(false);
  const [bankQuery, setBankQuery] = useState("");
  const [manualBank, setManualBank] = useState(
    Boolean(editing?.banco && !getExactBankSlug(editing.banco)),
  );
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!pageLayout) return;
    const ensureFocusedFieldVisible = () => {
      const form = formRef.current;
      const active = document.activeElement;
      if (!form || !(active instanceof HTMLElement) || !form.contains(active)) return;
      if (!active.matches("input, textarea, select")) return;
      const field = active.getBoundingClientRect();
      const footer = form.querySelector<HTMLElement>("[data-card-form-footer]");
      const bottom = Math.min(window.visualViewport?.height ?? window.innerHeight, footer?.getBoundingClientRect().top ?? Infinity) - 12;
      if (field.bottom > bottom) window.scrollBy(0, field.bottom - bottom);
      else if (field.top < 80) window.scrollBy(0, field.top - 80);
    };
    const onFocus = () => requestAnimationFrame(ensureFocusedFieldVisible);
    const form = formRef.current;
    form?.addEventListener("focusin", onFocus);
    window.visualViewport?.addEventListener("resize", ensureFocusedFieldVisible);
    return () => {
      form?.removeEventListener("focusin", onFocus);
      window.visualViewport?.removeEventListener("resize", ensureFocusedFieldVisible);
    };
  }, [pageLayout]);

  const formKey = editing?.id ?? "new";
  useMemo(() => {
    setNome(editing?.nome ?? "");
    setBanco(editing?.banco ?? "");
    setLimiteStr(editing ? editing.limiteTotal.toFixed(2).replace(".", ",") : "");
    setDiaFech(editing?.diaFechamento ?? 1);
    setDiaVenc(editing?.diaVencimento ?? 10);
    setObs(editing?.observacao ?? "");
    setShowObs(Boolean(editing?.observacao));
    setClosingTouched(Boolean(editing));
    setDueTouched(Boolean(editing));
    setBankOpen(false);
    setBankQuery("");
    setManualBank(Boolean(editing?.banco && !getExactBankSlug(editing.banco)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);

  const limite = parseBRLInput(limiteStr);
  const cor = getAutomaticCardColor(banco);
  const cardTheme = getCardTheme(cor, banco);
  const previewIdentity = getCardIdentity(nome || t("form.previewDefaultName"), banco);
  const filteredBanks = BANK_OPTIONS.filter((option) =>
    normalizeBankSearch(option.nome).includes(normalizeBankSearch(bankQuery.trim())),
  );
  // Regra compartilhada com o WhatsApp (limite > 0, dias 1–31, nome curto).
  const validacao = validarCartao({
    nome,
    limite: limiteStr,
    diaFechamento: diaFech,
    diaVencimento: diaVenc,
  });
  const valid = validacao.ok;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!valid) {
      toast.error(t("toast.checkFields"));
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (!(await requireOnline())) return;
      if (!validacao.ok) return;
      const payload: NovoCartaoInput = {
        nome: validacao.valor.nome,
        banco: banco.trim(),
        limiteTotal: validacao.valor.limiteTotal,
        diaFechamento: validacao.valor.diaFechamento,
        diaVencimento: validacao.valor.diaVencimento,
        cor,
        observacao: obs.trim() || undefined,
      };
      if (editing) {
        updateCartao(editing.id, payload);
        toast.success(t("toast.cardUpdated"));
      } else {
        const created = addCartao(payload);
        if (!created) return; // bloqueado por guard/quota; toast já exibido
        toast.success(t("toast.cardCreated"));
      }
      onSaved();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} aria-busy={submitting} className={cn("flex flex-col", pageLayout ? "flex-1 lg:flex-none" : "min-h-0 flex-1")}>
      <div className={cn("px-4 py-3 sm:px-5 lg:py-4", pageLayout ? "flex-1 lg:flex-none" : "min-h-0 flex-1 overflow-y-auto overscroll-contain")}>
        <div className="grid gap-3 md:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.2fr)] md:items-start md:gap-5">
          <section aria-label={t("form.liveCard")} data-live-card className="min-w-0 md:sticky md:top-6">
            <div
              className="relative flex min-h-[146px] flex-col justify-between overflow-hidden rounded-2xl p-3.5 shadow-card md:min-h-[180px] md:p-4"
              style={{ color: cardTheme.fg }}
            >
              <AnimatePresence initial={false}>
                <motion.div
                  key={cardTheme.background}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0"
                  style={{ background: cardTheme.background }}
                  initial={reducedMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.22 }}
                />
              </AnimatePresence>
              <div className="relative h-9 w-[120px]">
                <AnimatePresence initial={false}>
                  <motion.div
                    key={`${banco}-${cardTheme.logoTone}`}
                    className="absolute inset-0"
                    initial={reducedMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reducedMotion ? 0 : 0.18 }}
                  >
                    <BrandLogo name={banco} variant="bank" bankPresentation="card" bankCardTone={cardTheme.logoTone} className="h-9 w-[120px]" />
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="relative min-w-0">
                <div className="flex min-w-0 items-end justify-between gap-3">
                  <div className="min-w-0">
                    {previewIdentity.primary ? (
                      <>
                        <p className="truncate text-base font-bold leading-tight">{previewIdentity.primary}</p>
                        {previewIdentity.secondary && <p className="mt-0.5 truncate text-xs font-medium opacity-85">{previewIdentity.secondary}</p>}
                      </>
                    ) : (
                      <span className="sr-only">{previewIdentity.accessibleName}</span>
                    )}
                  </div>
                  <span className="num shrink-0 text-sm font-semibold">{formatBRL(limite || 0)}</span>
                </div>
                <div className="mt-2 flex items-center gap-4 text-[11px] font-medium opacity-85">
                  <span>{t("form.previewClosing", { day: closingTouched ? String(diaFech).padStart(2, "0") : "--" })}</span>
                  <span>{t("form.previewDue", { day: dueTouched ? String(diaVenc).padStart(2, "0") : "--" })}</span>
                </div>
              </div>
            </div>
          </section>
          <section aria-label={t("form.dataSection")} className="min-w-0 space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-1">
              <div className="min-w-0">
                <Label htmlFor="nome" className="text-xs text-muted-foreground">
                  {t("form.nameLabel")}
                </Label>
                <Input
                  id="nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder={t("form.namePlaceholder")}
                  maxLength={40}
                  className="mt-1 h-11 text-base sm:text-sm"
                />
              </div>

              <div className="min-w-0">
                <Label htmlFor="bank-picker" className="text-xs text-muted-foreground">
                  {t("form.bankLabel")}
                </Label>
                <Popover open={bankOpen} onOpenChange={setBankOpen}>
                  <PopoverTrigger asChild>
                    <button
                      id="bank-picker"
                      type="button"
                      className="mt-1 flex h-11 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {banco && !manualBank && <BrandLogo name={banco} variant="bank" bankPresentation="tiny" />}
                      <span className={cn("min-w-0 flex-1 truncate", !banco && "text-muted-foreground")}>
                        {banco || t("form.bankPlaceholder")}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    id="bank-picker-options"
                    portalContainer={pageLayout ? undefined : formRef.current ?? undefined}
                    align="start"
                    side="top"
                    sideOffset={6}
                    className="w-[var(--radix-popover-trigger-width)] max-h-[min(21rem,var(--radix-popover-content-available-height))] overflow-hidden rounded-xl border-border bg-popover p-2 shadow-elevated"
                  >
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        autoFocus
                        value={bankQuery}
                        onChange={(e) => setBankQuery(e.target.value)}
                        aria-label={t("form.bankSearch")}
                        placeholder={t("form.bankSearchPlaceholder")}
                        className="h-11 pl-9 text-base sm:text-sm"
                      />
                    </div>
                    <div className="mt-1 max-h-56 overflow-y-auto overscroll-contain">
                      {filteredBanks.map((option) => (
                        <button
                          key={option.nome}
                          type="button"
                          onClick={() => {
                            setBanco(option.nome);
                            setManualBank(false);
                            setBankOpen(false);
                            setBankQuery("");
                          }}
                          className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm hover:bg-card-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <BrandLogo name={option.nome} variant="bank" bankPresentation="tiny" />
                          <span className="flex-1">{option.nome}</span>
                          {banco === option.nome && <Check className="h-4 w-4 text-brand" aria-hidden="true" />}
                        </button>
                      ))}
                      {filteredBanks.length === 0 && (
                        <p className="px-2 py-2 text-xs text-muted-foreground">{t("form.bankNotFound")}</p>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setManualBank(true);
                          setBanco("");
                          setBankOpen(false);
                          setBankQuery("");
                        }}
                        className="flex min-h-11 w-full items-center gap-3 rounded-lg border-t border-border px-2 text-left text-sm hover:bg-card-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        {t("form.bankOther")}
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
                {manualBank && (
                  <Input
                    value={banco}
                    onChange={(e) => setBanco(e.target.value)}
                    aria-label={t("form.bankOtherLabel")}
                    placeholder={t("form.bankOtherPlaceholder")}
                    maxLength={30}
                    className="mt-2 h-11 text-base sm:text-sm"
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <Label htmlFor="limite" className="text-xs text-muted-foreground">{t("form.limitLabel")}</Label>
                <Input
                  id="limite"
                  inputMode="decimal"
                  value={limiteStr}
                  onChange={(e) => setLimiteStr(e.target.value)}
                  placeholder={t("form.limitPlaceholder")}
                  className="num mt-1 h-11 text-base sm:text-sm"
                />
              </div>
              <div className="min-w-0">
                <Label htmlFor="fech" className="text-xs text-muted-foreground">{t("form.closingDay")}</Label>
                <IntegerInput id="fech" min={1} max={31} value={diaFech} onValueChange={(value) => { setDiaFech(value); setClosingTouched(true); }} className="num mt-1 h-11 text-base sm:text-sm" />
              </div>
              <div className="min-w-0">
                <Label htmlFor="venc" className="text-xs text-muted-foreground">{t("form.dueDay")}</Label>
                <IntegerInput id="venc" min={1} max={31} fallback={10} value={diaVenc} onValueChange={(value) => { setDiaVenc(value); setDueTouched(true); }} className="num mt-1 h-11 text-base sm:text-sm" />
              </div>
            </div>

            <div>
              <button
                type="button"
                aria-expanded={showObs}
                aria-controls="card-observation"
                onClick={() => setShowObs((shown) => !shown)}
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className={cn("h-4 w-4 transition-transform", showObs && "rotate-45")} aria-hidden="true" />
                {showObs ? t("form.obsHide") : t("form.obsAdd")}
              </button>
              <AnimatePresence initial={false}>
              {showObs && (
                <motion.div
                  id="card-observation"
                  className="mt-1 overflow-hidden"
                  initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.23, 1, 0.32, 1] }}
                >
                  <Label htmlFor="obs" className="sr-only">{t("form.obsLabel")}</Label>
                  <Textarea
                    id="obs"
                    value={obs}
                    onChange={(e) => setObs(e.target.value)}
                    placeholder={t("form.obsPlaceholder")}
                    maxLength={200}
                    className="min-h-[70px] text-base sm:text-sm"
                  />
                </motion.div>
              )}
              </AnimatePresence>
            </div>
          </section>

        </div>
      </div>

      <div data-card-form-footer className={cn("flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 pb-[calc(0.75rem+var(--app-safe-bottom))] sm:px-5", pageLayout && "sticky bottom-0 z-10 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.35)] sm:static sm:shadow-none", footerClassName)}>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("form.securityShort")}
        </p>
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          <Button type="button" variant="outline" onClick={onCancel} className="h-11 min-w-24">{t("form.cancel")}</Button>
          <Button type="submit" disabled={!valid || submitting} className="h-11 min-w-28 bg-brand-grad font-semibold transition-opacity duration-150">{submitting ? t("form.saving", { defaultValue: "Salvando..." }) : t("form.save")}</Button>
        </div>
      </div>
    </form>
  );
}
