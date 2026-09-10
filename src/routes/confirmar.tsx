import { apiFetch } from "@/lib/api-fetch";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { usePremiumApiGate } from "@/lib/premium-errors";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ExternalLink,
  ImageUp,
  Loader2,
  PencilLine,
  ReceiptText,
  RefreshCcw,
  Sparkles,
  X,
} from "lucide-react";
import i18n from "@/i18n";
import { MobileShell } from "@/components/MobileShell";
import { Button } from "@/components/ui/button";
import { GastoForm } from "@/components/GastoForm";
import {
  addGasto,
  findDuplicateGastoAdvanced,
  getCategorias,
  useStore,
  type Gasto,
  type NovoGastoInput,
} from "@/lib/store";
import { requireOnline } from "@/lib/use-online-status";
import { formatBRL, todayISO } from "@/lib/format";
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
import { parseNfceQrContent, type ParsedNfceQrResult } from "@/lib/mercado/nfce-parser";
import { fetchNfceFromUrl } from "@/lib/mercado/nfce-fetch.functions";
import { mapNfceResultToExtracao, type NotaItemAuxiliar } from "@/lib/nota/nfce-to-gasto";

export const Route = createFileRoute("/confirmar")({
  head: () => {
    const t = i18n.getFixedT(null, "confirmar");
    return { meta: [{ title: t("metaTitle") }, { name: "robots", content: "noindex,follow" }] };
  },
  component: Confirmar,
});

type Step = "upload" | "qr" | "analisando" | "revisao" | "erro" | "sucesso";

type AIResult = {
  valor: number | null;
  valoresEncontrados: number[];
  data: string | null;
  descricao: string | null;
  categoriaSugerida: string | null;
  formaPagamento: FormaPagamento | null;
  confianca: "alta" | "media" | "baixa";
  observacao: string | null;
  itens?: NotaItemAuxiliar[];
  fonte?: "nfce_qr" | "ocr";
};

function Confirmar() {
  const { t, i18n: i18nInst } = useTranslation("confirmar");
  const { t: tc } = useTranslation("common");
  const premiumGate = usePremiumApiGate();
  const navigate = useNavigate();
  const { canWrite, requireSubscription } = useSubscriptionGuard();
  const categorias = useStore(() => getCategorias());
  const buscarNfce = useServerFn(fetchNfceFromUrl);

  const [imagem, setImagem] = useState<string | undefined>();
  const [step, setStep] = useState<Step>("upload");
  const [erro, setErro] = useState<string>("");
  const [result, setResult] = useState<AIResult | null>(null);
  const [overrideValor, setOverrideValor] = useState<number | null>(null);
  const [pending, setPending] = useState<null | (() => void)>(null);
  const [dupEncontrado, setDupEncontrado] = useState<Gasto | null>(null);
  const [qrInfo, setQrInfo] = useState<ParsedNfceQrResult | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrAviso, setQrAviso] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const analisarImagem = useCallback(
    async (img: string) => {
      setStep("analisando");
      setErro("");
      try {
        const resp = await apiFetch("/api/ocr-gasto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: img }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          if (
            premiumGate.handleResponse(resp, data, {
              title: tc("premium.premiumApi.ocrGasto.title"),
              description: tc("premium.premiumApi.ocrGasto.description"),
              fallbackFeature: "importacoes",
            })
          ) {
            setStep("upload");
            return;
          }
          setErro(data?.error ?? t("errors.ocrFallback"));
          setStep("erro");
          return;
        }
        setResult({ ...(data as AIResult), fonte: "ocr" });
        setStep("revisao");
      } catch (err) {
        console.error(err);
        setErro(t("errors.network"));
        setStep("erro");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tc],
  );

  // Entrada do fluxo: imagem e/ou QR capturados em /adicionar.
  // A imagem é processada AUTOMATICAMENTE (o usuário não escolhe o arquivo de novo).
  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    let img: string | undefined;
    let qrRaw: string | null = null;
    let auto = false;
    try {
      img = sessionStorage.getItem("gf:pendingImage") ?? undefined;
      qrRaw = sessionStorage.getItem("gf:pendingQr");
      auto = sessionStorage.getItem("gf:pendingAuto") === "1";
      sessionStorage.removeItem("gf:pendingImage");
      sessionStorage.removeItem("gf:pendingQr");
      sessionStorage.removeItem("gf:pendingAuto");
    } catch {
      /* noop */
    }
    if (img) setImagem(img);

    const parsed = qrRaw ? parseNfceQrContent(qrRaw) : null;
    const qrUtilizavel =
      !!parsed &&
      (parsed.status === "valid_nfce_url" || parsed.status === "possible_nfce_url") &&
      !!parsed.url;

    if (qrUtilizavel && parsed) {
      // NUNCA abrimos a URL: mostramos a nota encontrada e o usuário decide.
      setQrInfo(parsed);
      setStep("qr");
      return;
    }
    if (parsed && !qrUtilizavel) {
      setQrAviso(t("qr.notFiscal"));
    }
    if (img && auto) void analisarImagem(img);
  }, [analisarImagem, t]);

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
      const dataUrl = String(reader.result);
      setImagem(dataUrl);
      setResult(null);
      setOverrideValor(null);
      setQrInfo(null);
      void analisarImagem(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  async function analisar() {
    if (!imagem) return;
    await analisarImagem(imagem);
  }

  /** "Usar dados da nota": consulta server-side protegida (allowlist + anti-SSRF). */
  async function usarDadosDaNota() {
    if (!qrInfo?.url) return;
    setQrBusy(true);
    setQrAviso("");
    try {
      const res = await buscarNfce({ data: { url: qrInfo.url } });
      const extracao = mapNfceResultToExtracao(res);
      if (extracao) {
        setResult({
          valor: extracao.valor,
          valoresEncontrados: extracao.valoresEncontrados,
          data: extracao.data,
          descricao: extracao.descricao,
          categoriaSugerida: extracao.categoriaSugerida,
          formaPagamento: null,
          confianca: extracao.confianca,
          observacao: extracao.observacao,
          itens: extracao.itens,
          fonte: "nfce_qr",
        });
        setStep("revisao");
        return;
      }
      // Estado/portal não suportado, captcha, HTML diferente, timeout...
      setQrAviso(t("qr.fallbackOcr"));
      if (imagem) {
        await analisarImagem(imagem);
      } else {
        setStep("upload");
      }
    } catch {
      setQrAviso(t("qr.fallbackOcr"));
      if (imagem) await analisarImagem(imagem);
      else setStep("upload");
    } finally {
      setQrBusy(false);
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
        formaPagamento: result.formaPagamento ?? undefined,
        observacao: result.observacao ?? undefined,
        imagemUrl: imagem,
      }
    : undefined;

  // Deduplicação: MESMA função usada pelos importadores de extrato/fatura.
  const dupPrevia = useMemo(() => {
    if (step !== "revisao" || !result || !valorEscolhido) return undefined;
    return findDuplicateGastoAdvanced({
      valor: valorEscolhido,
      data: result.data ?? todayISO(),
      descricao: result.descricao ?? undefined,
      estabelecimento: result.descricao ?? undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, result, valorEscolhido]);

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
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("eyebrow")}</p>
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
          <p className="mt-1 text-sm text-muted-foreground">{t("success.subtitle")}</p>
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

      {step === "qr" && qrInfo && (
        <div className="mt-4 space-y-4 animate-rise" data-testid="qr-encontrado">
          <div className="rounded-3xl border border-success/40 bg-success/5 p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-success/15 text-success">
                <ReceiptText className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">{t("qr.foundTitle")}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{t("qr.foundDesc")}</p>
                {qrInfo.uf && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {t("qr.stateLabel")}: <span className="font-semibold">{qrInfo.uf}</span>
                  </p>
                )}
              </div>
            </div>

            {imagem && (
              <img
                src={imagem}
                alt={t("review.imageAlt")}
                className="mt-4 max-h-40 w-full rounded-2xl object-contain bg-card-elevated"
              />
            )}

            <div className="mt-5 space-y-2">
              <Button
                onClick={() => void usarDadosDaNota()}
                disabled={qrBusy}
                className="h-12 w-full rounded-2xl text-base font-semibold"
              >
                {qrBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {t("qr.useNota")}
              </Button>
              <Button
                variant="outline"
                disabled={qrBusy || !imagem}
                onClick={() => void analisar()}
                className="h-12 w-full rounded-2xl text-base font-semibold"
              >
                {t("qr.usePhoto")}
              </Button>
              {qrInfo.url && (
                <a
                  href={qrInfo.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex w-full items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  {t("qr.openOfficial")}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground">{t("qr.privacy")}</p>
        </div>
      )}

      {(step === "upload" || step === "analisando" || step === "erro") && (
        <>
          <p className="mt-3 text-sm text-muted-foreground">{t("intro")}</p>

          {qrAviso && (
            <p className="mt-3 rounded-2xl border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
              {qrAviso}
            </p>
          )}

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
                <p className="text-sm font-medium text-foreground">{t("upload.cta")}</p>
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
              <p className="mt-1 text-xs text-muted-foreground">{t("analyzing.subtitle")}</p>
              <ol className="mt-4 mx-auto flex max-w-xs flex-col gap-1 text-left text-[11px] text-muted-foreground">
                <li>✓ {t("analyzing.steps.received")}</li>
                <li>→ {t("analyzing.steps.identifying")}</li>
                <li>→ {t("analyzing.steps.preparing")}</li>
              </ol>
            </div>
          )}

          {step === "erro" && (
            <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 animate-fade-in">
              <p className="font-semibold">{t("error.title")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{erro || t("error.fallback")}</p>
              <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                <li>{t("error.tips.closer")}</li>
                <li>{t("error.tips.light")}</li>
                <li>{t("error.tips.whole")}</li>
              </ul>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => imagem && void analisar()}
                  disabled={!imagem}
                  className="rounded-xl"
                >
                  <RefreshCcw className="mr-1.5 h-4 w-4" />
                  {t("error.again")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl"
                >
                  <ImageUp className="mr-1.5 h-4 w-4" />
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
                onClick={() => void analisar()}
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
                  {result.fonte === "nfce_qr"
                    ? t("review.fromNota")
                    : result.valoresEncontrados.length > 1
                      ? t("review.foundMany")
                      : t("review.foundOne")}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {result.valoresEncontrados.length > 1 ? t("review.subMany") : t("review.subOne")}
                </p>
              </div>
              <ConfiancaBadge
                nivel={result.confianca}
                label={t(`confidence.${result.confianca}`)}
              />
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
                    const ativo = (overrideValor ?? result.valor ?? -1) === v;
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

            {!!result.itens?.length && (
              <details className="mt-3 rounded-xl bg-card-elevated px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold">
                  {t("review.itemsTitle", { count: result.itens.length })}
                </summary>
                <p className="mt-1 text-[11px] text-muted-foreground">{t("review.itemsHint")}</p>
                <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                  {result.itens.map((it, idx) => (
                    <li key={`${it.nome}-${idx}`} className="flex justify-between gap-2">
                      <span className="truncate">{it.nome}</span>
                      {typeof it.valor === "number" && (
                        <span className="shrink-0">{formatBRL(it.valor)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {dupPrevia && (
            <div
              data-testid="dup-aviso"
              className="rounded-3xl border border-warning/40 bg-warning/5 p-4"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{t("dupPreview.title")}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("dupPreview.desc")}</p>
                  <p className="mt-2 text-xs">
                    <span className="font-semibold">
                      {dupPrevia.estabelecimento || dupPrevia.descricao || "—"}
                    </span>
                    {" · "}
                    {dupPrevia.data}
                    {" · "}
                    {formatBRL(dupPrevia.valor)}
                  </p>
                </div>
              </div>
            </div>
          )}

          <GastoForm
            key={`${valorEscolhido ?? 0}-${result.data ?? ""}`}
            initial={initialForm}
            submitLabel={t("review.submit")}
            onSubmit={async (data) => {
              if (!(await requireOnline())) return;
              // ÚNICA lógica de deduplicação do produto (mesma dos importadores).
              const dup = findDuplicateGastoAdvanced({
                valor: data.valor,
                data: data.data,
                descricao: data.descricao,
                estabelecimento: data.estabelecimento,
                cartaoId: data.cartaoId,
                horario: data.horario,
              });
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
                setDupEncontrado(dup);
                setPending(() => save);
              } else {
                save();
              }
            }}
          />

          <p className="text-center text-xs text-muted-foreground">{t("review.tip")}</p>
        </div>
      )}

      <AlertDialog
        open={!!pending}
        onOpenChange={(o) => {
          if (!o) {
            setPending(null);
            setDupEncontrado(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dup.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dup.desc")}
              {dupEncontrado && (
                <span className="mt-2 block text-foreground">
                  {dupEncontrado.estabelecimento || dupEncontrado.descricao || "—"} ·{" "}
                  {dupEncontrado.data} · {formatBRL(dupEncontrado.valor)}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("dup.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                pending?.();
                setPending(null);
                setDupEncontrado(null);
              }}
            >
              {t("dup.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PremiumLockModal
        open={premiumGate.state.open}
        onOpenChange={(v) => {
          if (!v) premiumGate.close();
        }}
        title={premiumGate.state.title}
        description={premiumGate.state.description}
        feature={premiumGate.state.feature ?? undefined}
      />
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
