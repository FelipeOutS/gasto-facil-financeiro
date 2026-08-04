import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { QrCode, X, Loader2, Camera, ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Mercado Inteligente — Botão de leitura de QR Code (NFC-e / cupom fiscal).
 *
 * Estratégia em cascata (local-first, sem servidor):
 *  1) BarcodeDetector nativo com formato "qr_code".
 *  2) Fallback @zxing/browser para câmera ao vivo.
 *  3) Fallback "Enviar foto do QR Code", decodificado localmente via ZXing.
 *  4) Colagem manual continua disponível fora deste componente.
 *
 * Segurança:
 *  - Câmera só após toque do usuário.
 *  - Encerra stream ao fechar, detectar ou desmontar.
 *  - NÃO envia imagem para servidor.
 *  - NÃO salva nada automaticamente.
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
  onDetected: (content: string) => void;
  className?: string;
}

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

export function QrCodeScannerButton({ onDetected, className }: Props) {
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
    const text = (raw ?? "").trim();
    if (!text) return false;
    onDetected(text);
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
        nativeDetectorRef.current = new Ctor({ formats: ["qr_code"] });
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
            {t("importarCupom.scanner.scan")}
          </button>
          <button
            type="button"
            onClick={handlePickPhoto}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-card active:scale-[0.98]"
          >
            <ImagePlus className="h-4 w-4 text-muted-foreground" />
            {t("importarCupom.scanner.uploadPhoto")}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/60 bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-foreground">
              <QrCode className="h-4 w-4 text-muted-foreground" />
              {status === "decoding"
                ? t("importarCupom.scanner.decoding")
                : status === "scanning"
                  ? t("importarCupom.scanner.scanning")
                  : t("importarCupom.scanner.scan")}
            </span>
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex min-h-9 items-center gap-1 rounded-xl border border-border bg-card-elevated px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              {t("importarCupom.scanner.close")}
            </button>
          </div>

          {status === "unsupported" ? (
            <div className="mt-3 space-y-2">
              <p className="text-[12px] text-muted-foreground">
                {t("importarCupom.scanner.unsupported")} {t("importarCupom.scanner.manualFallback")}
              </p>
              <button
                type="button"
                onClick={handlePickPhoto}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card-elevated px-3 py-2 text-xs font-semibold text-foreground"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                {t("importarCupom.scanner.uploadPhoto")}
              </button>
            </div>
          ) : status === "denied" ? (
            <div className="mt-3 space-y-2">
              <p className="text-[12px] text-muted-foreground">
                {t("importarCupom.scanner.permissionDenied")}{" "}
                {t("importarCupom.scanner.manualFallback")}
              </p>
              <button
                type="button"
                onClick={handlePickPhoto}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card-elevated px-3 py-2 text-xs font-semibold text-foreground"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                {t("importarCupom.scanner.uploadPhoto")}
              </button>
            </div>
          ) : status === "error" ? (
            <p className="mt-3 text-[12px] text-muted-foreground">
              {t("importarCupom.scanner.cameraError")} {t("importarCupom.scanner.manualFallback")}
            </p>
          ) : status === "imageError" ? (
            <div className="mt-3 space-y-2">
              <p className="text-[12px] text-muted-foreground">
                {t("importarCupom.scanner.imageError")}
              </p>
              <button
                type="button"
                onClick={handlePickPhoto}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card-elevated px-3 py-2 text-xs font-semibold text-foreground"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                {t("importarCupom.scanner.tryAnotherPhoto")}
              </button>
            </div>
          ) : status === "decoding" ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("importarCupom.scanner.decoding")}
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
                    {t("importarCupom.scanner.scanning")}
                  </>
                ) : (
                  t("importarCupom.scanner.hint")
                )}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
