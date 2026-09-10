/**
 * Detecção de QR Code no navegador — helper único reutilizado pela câmera
 * controlada do Gasto Inteligente e pelo fallback por imagem.
 *
 * Cascata: BarcodeDetector nativo → @zxing/browser. Nada é enviado ao servidor.
 */

export type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

export function getNativeBarcodeDetector(): BarcodeDetectorLike | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (typeof ctor !== "function") return null;
  try {
    return new ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

export function hasGetUserMedia(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

type ZxingReader = {
  decodeFromImageUrl?: (url: string) => Promise<{ getText: () => string }>;
  decodeFromImageElement: (img: HTMLImageElement) => Promise<{ getText: () => string }>;
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

/** Tenta ler um QR Code em uma imagem (data URL). Devolve o conteúdo bruto ou null. */
export async function detectQrFromDataUrl(dataUrl: string): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const img = new Image();
  img.src = dataUrl;
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image_load_failed"));
    });
  } catch {
    return null;
  }

  const native = getNativeBarcodeDetector();
  if (native) {
    try {
      const codes = await native.detect(img);
      const first = codes.find((c) => (c.rawValue ?? "").trim());
      if (first) return first.rawValue.trim();
    } catch {
      /* cai para zxing */
    }
  }

  const reader = await loadZxing();
  if (!reader) return null;
  try {
    const res = await reader.decodeFromImageElement(img);
    const text = res.getText().trim();
    return text || null;
  } catch {
    return null;
  }
}

/** Converte um File em data URL (JPEG/PNG conforme o arquivo). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

/** Captura o frame atual de um <video> como JPEG data URL, com downscale. */
export function captureVideoFrame(video: HTMLVideoElement, maxWidth = 1400): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, maxWidth / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}
