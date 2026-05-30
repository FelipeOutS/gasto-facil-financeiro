import { apiFetch } from "@/lib/api-fetch";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ImageUp,
  Loader2,
  RefreshCcw,
  Sparkles,
  X,
  Check,
  PencilLine,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { GastoForm } from "@/components/GastoForm";
import {
  addGasto,
  findPossibleDuplicate,
  getCategorias,
  useStore,
  type NovoGastoInput,
} from "@/lib/store";
import { requireOnline } from "@/lib/use-online-status";
import { todayISO } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { FormaPagamento } from "@/lib/types";
import { useSubscriptionGuard } from "@/lib/subscription-guard";

export const Route = createFileRoute("/confirmar")({
  head: () => {
    const t = i18n.getFixedT(null, "confirmar");
    return { meta: [{ title: t("metaTitle") }] };
  },
  component: Confirmar,
});

type Step = "upload" | "analisando" | "revisao" | "erro" | "sucesso";

type AIResult = {
  valor: number | null;
  valoresEncontrados: number[];
  data: string | null;
  descricao: string | null;
  categoriaSugerida: string | null;
  formaPagamento: FormaPagamento | null;
  confianca: "alta" | "media" | "baixa";
  observacao: string | null;
};

function Confirmar() {
  const { t, i18n: i18nInst } = useTranslation("confirmar");
  const { t: tc } = useTranslation("common");
  const premiumGate = usePremiumApiGate();
  const navigate = useNavigate();
  const { canWrite, requireSubscription } = useSubscriptionGuard();
  const categorias = useStore(() => getCategorias());

  const [imagem, setImagem] = useState<string | undefined>();
  const [step, setStep] = useState<Step>("upload");
  const [erro, setErro] = useState<string>("");
  const [result, setResult] = useState<AIResult | null>(null);
  const [overrideValor, setOverrideValor] = useState<number | null>(null);
  const [pending, setPending] = useState<null | (() => void)>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const img = sessionStorage.getItem("gf:pendingImage") ?? undefined;
    if (img) {
      setImagem(img);
      sessionStorage.removeItem("gf:pendingImage");
    }
  }, []);

  function onPickFile(file?: File | null) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast.error(t("errors.fileType"));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error(t("errors.fileSize"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImagem(String(reader.result));
      setResult(null);
      setOverrideValor(null);
      setStep("upload");
    };
    reader.readAsDataURL(file);
  }

  async function analisar() {
    if (!imagem) return;
    setStep("analisando");
    setErro("");
    try {
      const resp = await apiFetch("/api/ocr-gasto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: imagem }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErro(data?.error ?? t("errors.ocrFallback"));
        setStep("erro");
        return;
      }
      setResult(data as AIResult);
      setStep("revisao");
    } catch (err) {
      console.error(err);
      setErro(t("errors.network"));
      setStep("erro");
    }
  }

  const categoriaIdSugerida = useMemo(() => {
    if (!result?.categoriaSugerida) return undefined;
    const found = categorias.find((c) => c.id === result.categoriaSugerida);
    return found?.id;
  }, [result, categorias]);

  const valorEscolhido = overrideValor ?? result?.valor ?? null;

  const initialForm: Partial<NovoGastoInput> | undefined = result
    ? {
        valor: valorEscolhido ?? 0,
        data: result.data ?? todayISO(),
        descricao: result.descricao ?? "",
        estabelecimento: result.descricao ?? "",
        categoriaId: categoriaIdSugerida,
        formaPagamento: result.formaPagamento ?? "pix",
        observacao: result.observacao ?? undefined,
        imagemUrl: imagem,
      }
    : undefined;

  const currencyLocale = i18nInst.language === "en" ? "en-US" : "pt-BR";
  const currencyCode = i18nInst.language === "en" ? "USD" : "BRL";

  return (
    <MobileShell>
      <header className="flex items-center gap-3 pt-2">
        <Link
          to="/adicionar"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label={t("back")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("eyebrow")}
          </p>
          <h1 className="text-xl font-bold tracking-tight">
            {step === "sucesso" ? t("headerDone") : t("header")}
          </h1>
        </div>
      </header>

      {step === "sucesso" && (
        <div className="mt-8 rounded-3xl border border-border bg-card p-6 text-center animate-rise">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success animate-pop">
            <Check className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">{t("success.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("success.subtitle")}
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => navigate({ to: "/gastos" })} className="rounded-xl card-press">
              {t("success.view")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setImagem(undefined);
                setResult(null);
                setOverrideValor(null);
                setStep("upload");
              }}
              className="rounded-xl card-press"
            >
              {t("success.another")}
            </Button>
          </div>
        </div>
      )}

      {(step === "upload" || step === "analisando" || step === "erro") && (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("intro")}
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0])}
          />

          <div className="mt-4 overflow-hidden rounded-3xl border border-border bg-card">
            {imagem ? (
              <div className="relative">
                <img
                  src={imagem}
                  alt={t("review.imageAlt")}
                  className="max-h-72 w-full object-contain bg-card-elevated"
                />
                <button
                  type="button"
                  onClick={() => {
                    setImagem(undefined);
                    setResult(null);
                    setOverrideValor(null);
                    setStep("upload");
                  }}
                  className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  aria-label={t("upload.remove")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 p-10 text-muted-foreground hover:bg-card-elevated transition-colors"
              >
                <ImageUp className="h-7 w-7" />
                <p className="text-sm font-medium text-foreground">
                  {t("upload.cta")}
                </p>
                <p className="text-xs">{t("upload.formats")}</p>
              </button>
            )}
          </div>

          {step === "analisando" && (
            <div className="mt-4 rounded-2xl border border-border bg-card p-5 text-center animate-rise">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-on-soft animate-breathe">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
              <p className="mt-3 font-semibold">{t("analyzing.title")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("analyzing.subtitle")}
              </p>
              <div className="mt-4 mx-auto flex max-w-xs items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand animate-pulse-soft" />
                <span>{t("analyzing.values")}</span>
                <span className="mx-1 text-border">·</span>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand/60 animate-pulse-soft" style={{ animationDelay: "0.3s" }} />
                <span>{t("analyzing.date")}</span>
                <span className="mx-1 text-border">·</span>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand/40 animate-pulse-soft" style={{ animationDelay: "0.6s" }} />
                <span>{t("analyzing.category")}</span>
              </div>
            </div>
          )}

          {step === "erro" && (
            <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 animate-fade-in">
              <p className="font-semibold">{t("error.title")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {erro || t("error.fallback")}
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl"
                >
                  <RefreshCcw className="mr-1.5 h-4 w-4" />
                  {t("error.retry")}
                </Button>
                <Button asChild className="rounded-xl">
                  <Link to="/manual">
                    <PencilLine className="mr-1.5 h-4 w-4" />
                    {t("error.manual")}
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {step === "upload" && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={analisar}
                disabled={!imagem}
                className="h-12 flex-1 rounded-2xl text-base font-semibold"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {t("upload.analyze")}
              </Button>
              {!imagem && (
                <Button
                  asChild
                  variant="outline"
                  className="h-12 rounded-2xl text-base font-semibold"
                >
                  <Link to="/manual">{t("upload.manual")}</Link>
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {step === "revisao" && result && (
        <div className="mt-4 space-y-4 animate-rise">
          <div className="rounded-3xl border border-border bg-card p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-brand-on-soft animate-pop">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold">
                  {result.valoresEncontrados.length > 1
                    ? t("review.foundMany")
                    : t("review.foundOne")}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {result.valoresEncontrados.length > 1
                    ? t("review.subMany")
                    : t("review.subOne")}
                </p>
              </div>
              <ConfiancaBadge nivel={result.confianca} label={t(`confidence.${result.confianca}`)} />
            </div>

            {imagem && (
              <img
                src={imagem}
                alt={t("review.imageAlt")}
                className="mt-3 max-h-40 w-full rounded-2xl object-contain bg-card-elevated"
              />
            )}

            {result.valoresEncontrados.length > 1 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("review.valuesLabel")}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 stagger">
                  {result.valoresEncontrados.map((v, idx) => {
                    const ativo =
                      (overrideValor ?? result.valor ?? -1) === v;
                    return (
                      <button
                        key={`${v}-${idx}`}
                        type="button"
                        onClick={() => setOverrideValor(v)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-semibold transition-all animate-fade-in",
                          ativo
                            ? "border-brand bg-brand/10 text-brand"
                            : "border-border bg-card-elevated hover:border-brand/40",
                        )}
                      >
                        {new Intl.NumberFormat(currencyLocale, {
                          style: "currency",
                          currency: currencyCode,
                        }).format(v)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {result.observacao && (
              <p className="mt-3 rounded-xl bg-card-elevated px-3 py-2 text-xs text-muted-foreground">
                💬 {result.observacao}
              </p>
            )}
          </div>

          <GastoForm
            key={`${valorEscolhido ?? 0}-${result.data ?? ""}`}
            initial={initialForm}
            submitLabel={t("review.submit")}
            onSubmit={async (data) => {
              if (!(await requireOnline())) return;
              const dup = findPossibleDuplicate(
                data.valor,
                data.data,
                data.estabelecimento,
              );
              const save = () => {
                if (!canWrite) {
                  requireSubscription(t("guard"));
                  return;
                }
                addGasto(data);
                toast.success(t("success.toast"));
                setStep("sucesso");
              };
              if (dup) {
                setPending(() => save);
              } else {
                save();
              }
            }}
          />

          <p className="text-center text-xs text-muted-foreground">
            {t("review.tip")}
          </p>
        </div>
      )}

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dup.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dup.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("dup.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                pending?.();
                setPending(null);
              }}
            >
              {t("dup.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileShell>
  );
}

function ConfiancaBadge({ nivel, label }: { nivel: "alta" | "media" | "baixa"; label: string }) {
  const cls = {
    alta: "bg-success/15 text-success",
    media: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    baixa: "bg-destructive/15 text-destructive",
  }[nivel];
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", cls)}>
      {label}
    </span>
  );
}
