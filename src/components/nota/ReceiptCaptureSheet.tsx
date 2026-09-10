/**
 * Captura CONTROLADA de nota/comprovante dentro do Gasto Inteligente.
 *
 * Por que existe: o fluxo antigo usava <input capture="environment">, que
 * entrega o usuário à câmera nativa do Android. Se o cupom tem QR Code da
 * NFC-e, a própria câmera do sistema oferece o link da SEFAZ e o usuário sai
 * do app sem importar nada.
 *
 * Aqui a pré-visualização e a leitura do QR acontecem DENTRO do app:
 *  - getUserMedia com câmera traseira;
 *  - leitura de QR ao vivo com BarcodeDetector quando disponível;
 *  - foto = frame do próprio vídeo (e o QR ainda é tentado via ZXing na foto);
 *  - galeria continua funcionando e cai no mesmo pipeline;
 *  - se getUserMedia falhar ou a permissão for negada, cai no seletor nativo
 *    e a imagem retornada segue automaticamente para análise.
 *
 * Nenhuma URL é aberta automaticamente: o QR é tratado como fonte de dados.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, ImagePlus, Loader2, ScanLine, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  captureVideoFrame,
  detectQrFromDataUrl,
  fileToDataUrl,
  getNativeBarcodeDetector,
  hasGetUserMedia,
  type BarcodeDetectorLike,
} from "@/lib/nota/qr-scan";

export type ReceiptCaptureResult = {
  imageDataUrl?: string;
  qrRaw?: string;
};

type Status = "starting" | "scanning" | "capturing" | "denied" | "unsupported" | "error";

interface Props {
  open: boolean;
  onClose: () => void;
  onResult: (result: ReceiptCaptureResult) => void;
}

export function ReceiptCaptureSheet({ open, onClose, onResult }: Props) {
  const { t } = useTranslation("adicionar");
  const [status, setStatus] = useState<Status>("starting");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const stoppedRef = useRef(true);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const nativeCameraRef = useRef<HTMLInputElement | null>(null);
  const doneRef = useRef(false);

  const stopCamera = useCallback(() => {
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
    detectorRef.current = null;
  }, []);

  const finish = useCallback(
    (result: ReceiptCaptureResult) => {
      if (doneRef.current) return;
      doneRef.current = true;
      stopCamera();
      onResult(result);
    },
    [onResult, stopCamera],
  );

  const handleClose = useCallback(() => {
    stopCamera();
    onClose();
  }, [onClose, stopCamera]);

  /** QR detectado ao vivo: NUNCA abre navegador; devolve o conteúdo + a foto. */
  const handleLiveQr = useCallback(
    (raw: string) => {
      const v = videoRef.current;
      const frame = v ? captureVideoFrame(v) : null;
      finish({ qrRaw: raw, imageDataUrl: frame ?? undefined });
    },
    [finish],
  );

  const startCamera = useCallback(async () => {
    doneRef.current = false;
    stoppedRef.current = false;
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
      for (const track of stream.getTracks()) track.stop();
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
      /* ignore */
    }
    setStatus("scanning");

    detectorRef.current = getNativeBarcodeDetector();
    if (!detectorRef.current) return; // sem leitura ao vivo: QR é tentado na foto
    const tick = async () => {
      if (stoppedRef.current) return;
      const detector = detectorRef.current;
      const video = videoRef.current;
      if (!detector || !video) return;
      try {
        if (video.readyState >= 2) {
          const codes = await detector.detect(video);
          const first = codes.find((c) => (c.rawValue ?? "").trim());
          if (first) {
            handleLiveQr(first.rawValue.trim());
            return;
          }
        }
      } catch {
        /* segue escaneando */
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [handleLiveQr, stopCamera]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    void startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleTakePhoto() {
    const v = videoRef.current;
    if (!v) return;
    setStatus("capturing");
    const frame = captureVideoFrame(v);
    if (!frame) {
      setStatus("scanning");
      return;
    }
    const qr = await detectQrFromDataUrl(frame);
    finish({ imageDataUrl: frame, qrRaw: qr ?? undefined });
  }

  async function handleImageFile(file: File) {
    setStatus("capturing");
    try {
      const dataUrl = await fileToDataUrl(file);
      const qr = await detectQrFromDataUrl(dataUrl);
      finish({ imageDataUrl: dataUrl, qrRaw: qr ?? undefined });
    } catch {
      setStatus("error");
    }
  }

  if (!open) return null;

  const fallback = status === "denied" || status === "unsupported" || status === "error";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("scan.title")}
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
    >
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void handleImageFile(f);
        }}
      />
      <input
        ref={nativeCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void handleImageFile(f);
        }}
      />

      <header className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("scan.eyebrow")}
          </p>
          <h2 className="truncate text-lg font-bold tracking-tight">{t("scan.title")}</h2>
        </div>
        <button
          type="button"
          onClick={handleClose}
          aria-label={t("scan.close")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <div className="mt-4 overflow-hidden rounded-3xl border border-border bg-card">
          <div className="relative">
            <video
              ref={videoRef}
              muted
              playsInline
              className={cn(
                "block aspect-[3/4] w-full bg-black object-cover",
                fallback && "hidden",
              )}
            />
            {!fallback && (
              <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-dashed border-white/70" />
            )}
            {status === "starting" && (
              <div className="absolute inset-0 grid place-items-center text-white">
                <Loader2 className="h-7 w-7 animate-spin" />
              </div>
            )}
            {status === "capturing" && (
              <div className="absolute inset-0 grid place-items-center bg-black/50 text-white">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t("scan.processing")}
                </div>
              </div>
            )}
            {fallback && (
              <div className="grid place-items-center gap-2 p-8 text-center">
                <ScanLine className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-semibold">
                  {status === "denied" ? t("scan.deniedTitle") : t("scan.unsupportedTitle")}
                </p>
                <p className="text-xs text-muted-foreground">{t("scan.fallbackHint")}</p>
              </div>
            )}
          </div>
        </div>

        {!fallback && (
          <div className="mt-4 text-center">
            <p className="text-base font-semibold">{t("scan.frameTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("scan.frameHint")}</p>
          </div>
        )}

        <div className="mt-5 space-y-3">
          {!fallback ? (
            <button
              type="button"
              onClick={() => void handleTakePhoto()}
              disabled={status !== "scanning"}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
            >
              <Camera className="h-5 w-5" />
              {t("scan.takePhoto")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => nativeCameraRef.current?.click()}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground"
            >
              <Camera className="h-5 w-5" />
              {t("scan.nativeCamera")}
            </button>
          )}

          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card text-base font-semibold"
          >
            <ImagePlus className="h-5 w-5 text-muted-foreground" />
            {t("scan.gallery")}
          </button>
        </div>

        <p className="mt-4 rounded-2xl border border-dashed border-border bg-card/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
          {t("scan.privacy")}
        </p>
      </div>
    </div>
  );
}
