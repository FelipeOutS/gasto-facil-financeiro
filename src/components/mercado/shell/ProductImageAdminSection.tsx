/**
 * Mercado Inteligente — seção administrativa de imagem dentro do modal
 * "Editar preço" (rota /mercado/preco-comunitario).
 *
 * Mostra preview grande, badge de origem e três ações (somente Admin Master):
 *  - Enviar imagem do computador (JPG/PNG/WebP, até 3 MB);
 *  - Buscar imagem automaticamente;
 *  - Remover imagem.
 *
 * Reaproveita as server functions seguras já existentes em
 * `product-image-admin.functions.ts`. Nenhuma migration nova.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { ImageOff, Upload, RefreshCw, Trash2, Loader2, ShoppingBasket, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  setProductImageAdmin,
  removeProductImageAdmin,
  refreshProductImageAdmin,
} from "@/lib/mercado/product-image-admin.functions";

const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") resolve(r);
      else reject(new Error("read_failed"));
    };
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

export interface ProductImageAdminSectionProps {
  priceId: string;
  currentImageUrl: string | null;
  currentImageSource: string | null;
  onChanged?: (next: {
    imageUrl: string | null;
    imageSource: string | null;
    imageConfidence?: number | null;
  }) => void;
}

export function ProductImageAdminSection({
  priceId,
  currentImageUrl,
  currentImageSource,
  onChanged,
}: ProductImageAdminSectionProps) {
  const { t } = useTranslation("mercado");
  const [busy, setBusy] = useState<"upload" | "remove" | "refresh" | null>(null);
  const [preview, setPreview] = useState<{ file: File; dataUrl: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const setFn = useServerFn(setProductImageAdmin);
  const removeFn = useServerFn(removeProductImageAdmin);
  const refreshFn = useServerFn(refreshProductImageAdmin);

  const sourceBadge = currentImageUrl
    ? currentImageSource
      ? t(`shell.product.adminImage.sourceBadge.${currentImageSource}`, {
          defaultValue: currentImageSource,
        })
      : t("shell.product.adminImage.sourceBadge.manual")
    : t("shell.product.adminImage.sourceBadge.none");

  function pickFile() {
    fileRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
      toast.error(t("shell.product.adminImage.toast.invalidFormat"));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t("shell.product.adminImage.toast.tooLarge"));
      return;
    }
    try {
      const dataUrl = await fileToBase64(file);
      setPreview({ file, dataUrl });
    } catch {
      toast.error(t("shell.product.adminImage.toast.readError"));
    }
  }

  async function confirmUpload() {
    if (!preview) return;
    setBusy("upload");
    try {
      const res = await setFn({
        data: {
          priceId,
          fileBase64: preview.dataUrl,
          mimeType: preview.file.type as (typeof ALLOWED_MIME)[number],
          originalFileName: preview.file.name,
        },
      });
      toast.success(t("shell.product.adminImage.toast.uploaded"));
      onChanged?.({ imageUrl: res.imageUrl, imageSource: res.imageSource, imageConfidence: 1 });
      setPreview(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "UPLOAD_FAILED";
      if (msg === "FILE_TOO_LARGE") toast.error(t("shell.product.adminImage.toast.tooLarge"));
      else if (msg === "INVALID_MIME")
        toast.error(t("shell.product.adminImage.toast.invalidFormat"));
      else if (msg === "FORBIDDEN") toast.error(t("shell.product.adminImage.toast.forbidden"));
      else toast.error(t("shell.product.adminImage.toast.uploadFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    if (!currentImageUrl) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("communityPrices.image.section.confirmRemove"))
    ) {
      return;
    }
    setBusy("remove");
    try {
      await removeFn({ data: { priceId } });
      toast.success(t("shell.product.adminImage.toast.removed"));
      onChanged?.({ imageUrl: null, imageSource: null, imageConfidence: null });
    } catch {
      toast.error(t("shell.product.adminImage.toast.removeFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh() {
    setBusy("refresh");
    try {
      const res = await refreshFn({
        data: { priceId, force: currentImageSource === "admin_upload" ? false : true },
      });
      if (res.ok) {
        toast.success(t("shell.product.adminImage.toast.refreshed"));
        onChanged?.({
          imageUrl: res.imageUrl ?? null,
          imageSource: res.imageSource ?? null,
          imageConfidence: null,
        });
      } else if (res.reason === "admin_upload_protected") {
        toast.message(t("shell.product.adminImage.toast.protectedFromAuto"));
      } else {
        toast.message(t("shell.product.adminImage.toast.noMatch"));
      }
    } catch {
      toast.error(t("shell.product.adminImage.toast.refreshFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sm:col-span-2 space-y-3 rounded-xl border border-border/60 bg-card-elevated/40 p-3">
      <div>
        <h4 className="text-sm font-semibold text-foreground">
          {t("communityPrices.image.section.title")}
        </h4>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t("communityPrices.image.section.description")}
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex items-start gap-3">
        <div className="relative grid aspect-square w-28 shrink-0 place-items-center overflow-hidden rounded-xl border border-border/60 bg-muted p-2">
          {currentImageUrl ? (
            <img
              src={currentImageUrl}
              alt={t("communityPrices.image.section.previewAlt")}
              className="h-full w-full object-contain"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-center text-muted-foreground">
              <ShoppingBasket className="h-7 w-7 opacity-60" aria-hidden="true" />
              <span className="text-[10px] leading-tight">
                {t("communityPrices.image.section.empty")}
              </span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span
            className="inline-flex w-fit items-center rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
            title={sourceBadge}
          >
            {sourceBadge}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={pickFile}
              disabled={!!busy}
              className="min-h-9"
            >
              {busy === "upload" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("communityPrices.image.section.uploadCta")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={!!busy}
              className="min-h-9"
            >
              {busy === "refresh" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("communityPrices.image.section.refreshCta")}
            </Button>
            {currentImageUrl && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRemove}
                disabled={!!busy}
                className="min-h-9 text-destructive hover:text-destructive"
              >
                {busy === "remove" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                {t("communityPrices.image.section.removeCta")}
              </Button>
            )}
          </div>
          {!currentImageUrl && (
            <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <ImageOff className="h-3 w-3" />
              {t("communityPrices.image.section.hintFallback")}
            </p>
          )}
        </div>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-elevated">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {t("shell.product.adminImage.preview.title")}
              </h3>
              <button
                type="button"
                aria-label={t("shell.product.adminImage.preview.cancel")}
                onClick={() => setPreview(null)}
                disabled={busy === "upload"}
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 grid aspect-square w-full overflow-hidden rounded-xl bg-muted">
              <img
                src={preview.dataUrl}
                alt={t("shell.product.adminImage.preview.alt")}
                className="h-full w-full object-contain"
              />
            </div>
            <p
              className="mt-2 truncate text-[11px] text-muted-foreground"
              title={preview.file.name}
            >
              {preview.file.name} · {(preview.file.size / 1024).toFixed(0)} KB
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={busy === "upload"}
                className="h-10 flex-1 rounded-full border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {t("shell.product.adminImage.preview.cancel")}
              </button>
              <button
                type="button"
                onClick={confirmUpload}
                disabled={busy === "upload"}
                className="h-10 flex-1 rounded-full bg-brand-grad text-sm font-semibold text-primary-foreground shadow-elevated disabled:opacity-60"
              >
                {busy === "upload"
                  ? t("shell.product.adminImage.preview.uploading")
                  : t("shell.product.adminImage.preview.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
