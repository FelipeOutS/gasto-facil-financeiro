import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScanBarcode, X, Loader2, Camera, ImagePlus } from "lucide-react";
import { normalizeBarcode } from "@/lib/mercado/products-api";
import { cn } from "@/lib/utils";

/**
 * Mercado Inteligente — Botão de leitura de código de barras.
 *
 * Estratégia em cascata (local-first, sem servidor):
 *  1) BarcodeDetector nativo (Android Chrome moderno) — mais rápido.
 *  2) Fallback @zxing/browser para câmera ao vivo (iOS Safari, WebView etc.).
 *  3) Fallback "Enviar foto do código" (input file capture=environment),
 *     decodificado localmente via @zxing/library.
 *  4) Digitação manual continua sempre disponível fora deste componente.
 *
 * Segurança:
 *  - câmera só após toque do usuário;
 *  - encerra stream ao fechar, detectar ou desmontar;
 *  - não envia imagem para servidor; não salva nada automaticamente.
 */

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function getNativeBarcodeDetector(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

function hasGetUserMedia(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

type ScanStatus =
  | "idle"
  | "starting"
  | "scanning"
  | "decoding"
  | "unsupported"
  | "denied"
  | "error"
  | "imageError";

interface Props {
  onDetected: (code: string) => void;
  className?: string;
}

// Carrega ZXing sob demanda para não pesar no bundle inicial.
type ZxingReader = {
  decodeFromStream: (
    stream: MediaStream,
    video: HTMLVideoElement,
    cb: (result: { getText: () => string } | null) => void,
  ) => Promise<{ stop: () => void }>;
  decodeFromImageElement: (img: HTMLImageElement) => Promise<{ getText: () => string }>;
  reset?: () => void;
};
async function loadZxing(): Promise<ZxingReader | null> {
  try {
    const mod = await import("@zxing/browser");
    const Reader = (mod as unknown as { BrowserMultiFormatReader: new () => ZxingReader })
      .BrowserMultiFormatReader;
    return new Reader();
  } catch {
    return null;
  }
}

export function BarcodeScannerButton({ onDetected, className }: Props) {
  const { t } = useTranslation("mercado");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ScanStatus>("idle");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const nativeDetectorRef = useRef<BarcodeDetectorLike | null>(null);
  const zxingRef = useRef<ZxingReader | null>(null);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stoppedRef = useRef(false);

  function stopCamera() {
    stoppedRef.current = true;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (zxingControlsRef.current) {
      try {
        zxingControlsRef.current.stop();
      } catch {
        /* ignore */
      }
      zxingControlsRef.current = null;
    }
    if (zxingRef.current?.reset) {
      try {
        zxingRef.current.reset();
      } catch {
        /* ignore */
      }
    }
    zxingRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {
        /* ignore */
      }
      videoRef.current.srcObject = null;
    }
    nativeDetectorRef.current = null;
  }

  function handleClose() {
    stopCamera();
    setOpen(false);
    setStatus("idle");
  }

  function handleDetected(raw: string) {
    const norm = normalizeBarcode(raw ?? "");
    if (!/^\d{8,14}$/.test(norm)) return false;
    onDetected(norm);
    handleClose();
    return true;
  }

  function nativeScanLoop() {
    const tick = async () => {
      if (stoppedRef.current) return;
      const detector = nativeDetectorRef.current;
      const v = videoRef.current;
      if (!detector || !v || !streamRef.current) return;
      try {
        if (v.readyState >= 2) {
          const codes = await detector.detect(v);
          for (const c of codes) {
            if (handleDetected(c.rawValue ?? "")) return;
          }
        }
      } catch {
        /* keep scanning */
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function startZxingScan(stream: MediaStream) {
    const reader = await loadZxing();
    if (!reader || stoppedRef.current) {
      if (!reader) setStatus("unsupported");
      return;
    }
    zxingRef.current = reader;
    const v = videoRef.current;
    if (!v) return;
    try {
      // decodeFromStream reuses the MediaStream we already acquired —
      // avoids a second getUserMedia call / permission prompt.
      const controls = await reader.decodeFromStream(stream, v, (result) => {
        if (stoppedRef.current || !result) return;
        handleDetected(result.getText());
      });
      zxingControlsRef.current = controls;
    } catch {
      setStatus("error");
      stopCamera();
    }
  }

  async function handleOpenCamera() {
    stoppedRef.current = false;
    setOpen(true);

    if (!hasGetUserMedia()) {
      setStatus("unsupported");
      return;
    }

    setStatus("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name;
      setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      return;
    }
    if (stoppedRef.current) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    streamRef.current = stream;

    const Ctor = getNativeBarcodeDetector();
    if (Ctor) {
      try {
        nativeDetectorRef.current = new Ctor({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"],
        });
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
          /* ignore */
        }
        setStatus("scanning");
        nativeScanLoop();
        return;
      } catch {
        /* fall through to zxing */
      }
    }

    setStatus("scanning");
    await startZxingScan(stream);
  }

  function handlePickPhoto() {
    setOpen(true);
    setStatus("idle");
    fileInputRef.current?.click();
  }

  async function handleFileChosen(file: File) {
    setStatus("decoding");
    try {
      const reader = await loadZxing();
      if (!reader) {
        setStatus("unsupported");
        return;
      }
      zxingRef.current = reader;
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("image_load_failed"));
        });
        const result = await reader.decodeFromImageElement(img);
        if (!handleDetected(result.getText())) {
          setStatus("imageError");
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      setStatus("imageError");
    }
  }

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <div className={cn("w-full", className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void handleFileChosen(f);
        }}
      />

      {!open ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => void handleOpenCamera()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-card active:scale-[0.98]"
          >
            <Camera className="h-4 w-4 text-muted-foreground" />
            {t("detail.barcodeScanner.scan")}
          </button>
          <button
            type="button"
            onClick={handlePickPhoto}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-card active:scale-[0.98]"
          >
            <ImagePlus className="h-4 w-4 text-muted-foreground" />
            {t("detail.barcodeScanner.uploadPhoto")}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/60 bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-foreground">
              <ScanBarcode className="h-4 w-4 text-muted-foreground" />
              {status === "decoding"
                ? t("detail.barcodeScanner.decoding")
                : status === "scanning"
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
            <div className="mt-3 space-y-2">
              <p className="text-[12px] text-muted-foreground">
                {t("detail.barcodeScanner.unsupported")} {t("detail.barcodeScanner.manualFallback")}
              </p>
              <button
                type="button"
                onClick={handlePickPhoto}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card-elevated px-3 py-2 text-xs font-semibold text-foreground"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                {t("detail.barcodeScanner.uploadPhoto")}
              </button>
            </div>
          ) : status === "denied" ? (
            <div className="mt-3 space-y-2">
              <p className="text-[12px] text-muted-foreground">
                {t("detail.barcodeScanner.permissionDenied")}{" "}
                {t("detail.barcodeScanner.manualFallback")}
              </p>
              <button
                type="button"
                onClick={handlePickPhoto}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card-elevated px-3 py-2 text-xs font-semibold text-foreground"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                {t("detail.barcodeScanner.uploadPhoto")}
              </button>
            </div>
          ) : status === "error" ? (
            <p className="mt-3 text-[12px] text-muted-foreground">
              {t("detail.barcodeScanner.cameraError")} {t("detail.barcodeScanner.manualFallback")}
            </p>
          ) : status === "imageError" ? (
            <div className="mt-3 space-y-2">
              <p className="text-[12px] text-muted-foreground">
                {t("detail.barcodeScanner.imageError")}
              </p>
              <button
                type="button"
                onClick={handlePickPhoto}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card-elevated px-3 py-2 text-xs font-semibold text-foreground"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                {t("detail.barcodeScanner.tryAnotherPhoto")}
              </button>
            </div>
          ) : status === "decoding" ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("detail.barcodeScanner.decoding")}
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
