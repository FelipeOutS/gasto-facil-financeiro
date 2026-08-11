import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCardTheme } from "@/lib/card-theme";
import { formatBRL, parseBRLInput } from "@/lib/format";
import { addCartao, updateCartao, type NovoCartaoInput } from "@/lib/store";
import { requireOnline } from "@/lib/use-online-status";
import type { Cartao } from "@/lib/types";
import { BANCOS_CARTAO_PADRAO } from "@/lib/types";
import { cn } from "@/lib/utils";

export const CORES_CARTAO = [
  "#820ad1",
  "#ec7000",
  "#ec0000",
  "#00b1ea",
  "#ff7a00",
  "#3a3a3a",
  "#cc092f",
  "#1c5aa8",
  "#21c25e",
  "#0f9b5e",
  "#8b5cf6",
  "#0ea5e9",
];

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
}: {
  editing: Cartao | null;
  onCancel: () => void;
  onSaved: () => void;
  footerClassName?: string;
}) {
  const { t } = useTranslation("cartoes");
  const [nome, setNome] = useState(editing?.nome ?? "");
  const [banco, setBanco] = useState(editing?.banco ?? "");
  const [limiteStr, setLimiteStr] = useState(
    editing ? editing.limiteTotal.toFixed(2).replace(".", ",") : "",
  );
  const [diaFech, setDiaFech] = useState<number>(editing?.diaFechamento ?? 1);
  const [diaVenc, setDiaVenc] = useState<number>(editing?.diaVencimento ?? 10);
  const [cor, setCor] = useState(editing?.cor ?? CORES_CARTAO[0]);
  const [obs, setObs] = useState(editing?.observacao ?? "");

  const formKey = editing?.id ?? "new";
  useMemo(() => {
    setNome(editing?.nome ?? "");
    setBanco(editing?.banco ?? "");
    setLimiteStr(editing ? editing.limiteTotal.toFixed(2).replace(".", ",") : "");
    setDiaFech(editing?.diaFechamento ?? 1);
    setDiaVenc(editing?.diaVencimento ?? 10);
    setCor(editing?.cor ?? CORES_CARTAO[0]);
    setObs(editing?.observacao ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);

  const limite = parseBRLInput(limiteStr);
  const valid =
    nome.trim().length > 0 &&
    limite >= 0 &&
    diaFech >= 1 &&
    diaFech <= 31 &&
    diaVenc >= 1 &&
    diaVenc <= 31;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error(t("toast.checkFields"));
      return;
    }
    if (!(await requireOnline())) return;
    const payload: NovoCartaoInput = {
      nome: nome.trim(),
      banco: banco.trim(),
      limiteTotal: limite,
      diaFechamento: diaFech,
      diaVencimento: diaVenc,
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
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(280px,360px)] lg:gap-8">
          <div className="space-y-5 animate-rise">
            {!editing && (
              <p className="rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                🔒 {t("form.security")}
              </p>
            )}
            <section className="space-y-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("form.dataSection")}
              </h3>

              <div>
                <Label htmlFor="nome" className="text-xs text-muted-foreground">
                  {t("form.nameLabel")}
                </Label>
                <Input
                  id="nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder={t("form.namePlaceholder")}
                  maxLength={40}
                  className="mt-1.5 h-11"
                />
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">{t("form.bankLabel")}</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {BANCOS_CARTAO_PADRAO.map((b) => {
                    const active = banco === b.nome;
                    return (
                      <button
                        key={b.nome}
                        type="button"
                        onClick={() => {
                          setBanco(b.nome);
                          setCor(b.cor);
                        }}
                        className={cn(
                          "card-press rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                          active
                            ? "border-brand bg-brand-soft text-brand-on-soft shadow-card"
                            : "border-border bg-card hover:-translate-y-0.5 hover:bg-card-elevated",
                        )}
                      >
                        {b.nome}
                      </button>
                    );
                  })}
                </div>
                <Input
                  value={banco}
                  onChange={(e) => setBanco(e.target.value)}
                  placeholder={t("form.bankPlaceholder")}
                  maxLength={30}
                  className="mt-2.5 h-10"
                />
              </div>

              <div>
                <Label htmlFor="limite" className="text-xs text-muted-foreground">
                  {t("form.limitLabel")}
                </Label>
                <Input
                  id="limite"
                  inputMode="decimal"
                  value={limiteStr}
                  onChange={(e) => setLimiteStr(e.target.value)}
                  placeholder={t("form.limitPlaceholder")}
                  className="num mt-1.5 h-11"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="fech" className="text-xs text-muted-foreground">
                    {t("form.closingDay")}
                  </Label>
                  <IntegerInput
                    id="fech"
                    min={1}
                    max={31}
                    value={diaFech}
                    onValueChange={setDiaFech}
                    className="num mt-1.5 h-11"
                  />
                </div>
                <div>
                  <Label htmlFor="venc" className="text-xs text-muted-foreground">
                    {t("form.dueDay")}
                  </Label>
                  <IntegerInput
                    id="venc"
                    min={1}
                    max={31}
                    fallback={10}
                    value={diaVenc}
                    onValueChange={setDiaVenc}

                    className="num mt-1.5 h-11"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="obs" className="text-xs text-muted-foreground">
                  {t("form.obsLabel")}
                </Label>
                <Textarea
                  id="obs"
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  placeholder={t("form.obsPlaceholder")}
                  maxLength={200}
                  className="mt-1.5 min-h-[72px]"
                />
              </div>
            </section>
          </div>

          <div className="space-y-5 animate-rise">
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("form.previewTitle")}
              </h3>
              <div
                className="relative mt-2 aspect-[1.586/1] w-full overflow-hidden rounded-2xl p-5 text-white shadow-elevated transition-[background] duration-500 ease-out"
                style={{ background: getCardTheme(cor, banco).background }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl"
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent"
                />
                <div className="relative flex h-full flex-col justify-between">
                  <div className="flex items-center">
                    <BrandLogo name={banco} variant="bank" onDark />
                  </div>
                  <div>
                    <p className="truncate text-lg font-bold leading-tight">
                      {nome || t("form.previewDefaultName")}
                    </p>
                    <div className="mt-2 flex items-end justify-between gap-2">
                      <div>
                        <p className="text-[9px] uppercase tracking-widest text-white/70">
                          {t("form.previewLimit")}
                        </p>
                        <p className="num text-sm font-semibold">{formatBRL(limite || 0)}</p>
                      </div>
                      <span className="text-[10px] uppercase tracking-widest text-white/70">
                        {t("form.previewType")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("form.appearanceTitle")}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">{t("form.appearanceHint")}</p>
              <div className="mt-3 flex flex-wrap gap-2.5">
                {CORES_CARTAO.map((c) => {
                  const active = cor === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCor(c)}
                      aria-label={t("form.colorLabel", { color: c })}
                      aria-pressed={active}
                      className={cn(
                        "relative h-10 w-10 rounded-full border-2 transition-all duration-200",
                        active
                          ? "scale-110 border-foreground shadow-card animate-pop"
                          : "border-transparent hover:scale-105 hover:shadow-card",
                      )}
                      style={{ background: c }}
                    >
                      {active && (
                        <span className="absolute inset-0 grid place-items-center text-white drop-shadow">
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "shrink-0 flex flex-col-reverse gap-2 border-t border-border bg-card/80 px-4 py-4 backdrop-blur sm:flex-row sm:justify-end sm:gap-2 sm:px-6",
          footerClassName,
        )}
      >
        <Button type="button" variant="outline" onClick={onCancel} className="card-press">
          {t("form.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!valid}
          className="card-press bg-brand-grad font-semibold shadow-elevated hover:opacity-95"
        >
          {t("form.save")}
        </Button>
      </div>
    </form>
  );
}
