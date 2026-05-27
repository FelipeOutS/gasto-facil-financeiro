import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScanBarcode, X, Loader2 } from "lucide-react";
import { normalizeBarcode } from "@/lib/mercado/products-api";
import { cn } from "@/lib/utils";

/**
 * Mercado Inteligente — Botão de leitura de código de barras pela câmera.
 *
 * Seguro e opcional:
 * - usa a câmera apenas após toque do usuário;
 * - prefere a API nativa BarcodeDetector quando disponível;
 * - fallback amigável quando não suportado ou permissão negada;
 * - encerra o stream da câmera ao fechar, detectar ou desmontar;
 * - não envia imagem para servidor, não salva nada.
 */

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

type ScanStatus =
  | "idle"
  | "starting"
  | "scanning"
  | "unsupported"
  | "denied"
  | "error";

interface Props {
  onDetected: (code: string) => void;
  className?: string;
}

export function BarcodeScannerButton({ onDetected, className }: Props) {
  const { t } = useTranslation("mercado");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const stoppedRef = useRef(false);

  function stopCamera() {
    stoppedRef.current = true;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {
        // ignore
      }
      videoRef.current.srcObject = null;
    }
    detectorRef.current = null;
  }

  function handleClose() {
    stopCamera();
    setOpen(false);
    setStatus("idle");
  }

  function scanLoop() {
    const tick = async () => {
      if (stoppedRef.current) return;
      const detector = detectorRef.current;
      const v = videoRef.current;
      if (!detector || !v || !streamRef.current) return;
      try {
        if (v.readyState >= 2) {
          const codes = await detector.detect(v);
          for (const c of codes) {
            const norm = normalizeBarcode(c.rawValue ?? "");
            if (/^\d{8,14}$/.test(norm)) {
              onDetected(norm);
              handleClose();
              return;
            }
          }
        }
      } catch {
        // ignore frame errors, keep scanning
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function handleOpen() {
    stoppedRef.current = false;
    setOpen(true);

    const Ctor = getBarcodeDetector();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    try {
      detectorRef.current = new Ctor({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"],
      });
    } catch {
      setStatus("unsupported");
      return;
    }

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setStatus("unsupported");
      return;
    }

    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (stoppedRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) {
        stopCamera();
        setStatus("error");
        return;
      }
      v.srcObject = stream;
      v.setAttribute("playsinline", "true");
      try {
        await v.play();
      } catch {
        // some browsers resolve later; keep going
      }
      setStatus("scanning");
      scanLoop();
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus("denied");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setStatus("error");
      } else {
        setStatus("error");
      }
      stopCamera();
    }
  }

  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={cn("w-full", className)}>
      {!open ? (
        <button
          type="button"
          onClick={() => void handleOpen()}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-card active:scale-[0.98] sm:w-auto"
        >
          <ScanBarcode className="h-4 w-4 text-muted-foreground" />
          {t("detail.barcodeScanner.scan")}
        </button>
      ) : (
        <div className="rounded-2xl border border-border/60 bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-foreground">
              <ScanBarcode className="h-4 w-4 text-muted-foreground" />
              {status === "scanning"
                ? t("detail.barcodeScanner.scanning")
                : t("detail.barcodeScanner.scan")}
            </span>
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex min-h-9 items-center gap-1 rounded-xl border border-border bg-card-elevated px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              {t("detail.barcodeScanner.close")}
            </button>
          </div>

          {status === "unsupported" ? (
            <p className="mt-3 text-[12px] text-muted-foreground">
              {t("detail.barcodeScanner.unsupported")} {t("detail.barcodeScanner.manualFallback")}
            </p>
          ) : status === "denied" ? (
            <p className="mt-3 text-[12px] text-muted-foreground">
              {t("detail.barcodeScanner.permissionDenied")} {t("detail.barcodeScanner.manualFallback")}
            </p>
          ) : status === "error" ? (
            <p className="mt-3 text-[12px] text-muted-foreground">
              {t("detail.barcodeScanner.cameraError")} {t("detail.barcodeScanner.manualFallback")}
            </p>
          ) : (
            <>
              <div className="mt-3 overflow-hidden rounded-xl border border-border/60 bg-background">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className="block aspect-[4/3] w-full bg-black object-cover"
                />
              </div>
              <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                {status === "starting" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("detail.barcodeScanner.scanning")}
                  </>
                ) : (
                  t("detail.barcodeScanner.hint")
                )}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
