/**
 * Mercado Inteligente — menu administrativo de imagem do produto.
 *
 * Visível apenas para Admin Master (full access). Permite:
 *  - substituir imagem por upload local (jpg/png/webp, até 3 MB);
 *  - remover imagem atual;
 *  - rebuscar imagem automaticamente (Open Food Facts / logo de marca).
 *
 * Toda persistência ocorre via server functions seguras em
 * `product-image-admin.functions.ts`.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { ImageIcon, MoreVertical, Upload, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
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

export interface ProductImageAdminMenuProps {
  priceId: string;
  currentImageUrl?: string | null;
  currentImageSource?: string | null;
  onChanged?: (next: { imageUrl: string | null; imageSource: string | null }) => void;
}

export function ProductImageAdminMenu({
  priceId,
  currentImageUrl,
  currentImageSource,
  onChanged,
}: ProductImageAdminMenuProps) {
  const { t } = useTranslation("mercado");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"upload" | "remove" | "refresh" | null>(null);
  const [preview, setPreview] = useState<{ file: File; dataUrl: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const setFn = useServerFn(setProductImageAdmin);
  const removeFn = useServerFn(removeProductImageAdmin);
  const refreshFn = useServerFn(refreshProductImageAdmin);

  const sourceBadge = currentImageSource
    ? t(`shell.product.adminImage.sourceBadge.${currentImageSource}`, {
        defaultValue: currentImageSource,
      })
    : null;

  function pickFile() {
    setOpen(false);
    fileRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite reabrir o mesmo arquivo
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
      onChanged?.({ imageUrl: res.imageUrl, imageSource: res.imageSource });
      setPreview(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "UPLOAD_FAILED";
      if (msg === "FILE_TOO_LARGE") toast.error(t("shell.product.adminImage.toast.tooLarge"));
      else if (msg === "INVALID_MIME") toast.error(t("shell.product.adminImage.toast.invalidFormat"));
      else if (msg === "FORBIDDEN") toast.error(t("shell.product.adminImage.toast.forbidden"));
      else toast.error(t("shell.product.adminImage.toast.uploadFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    setOpen(false);
    setBusy("remove");
    try {
      await removeFn({ data: { priceId } });
      toast.success(t("shell.product.adminImage.toast.removed"));
      onChanged?.({ imageUrl: null, imageSource: null });
    } catch {
      toast.error(t("shell.product.adminImage.toast.removeFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh() {
    setOpen(false);
    setBusy("refresh");
    try {
      const res = await refreshFn({ data: { priceId, force: currentImageSource === "admin_upload" ? false : true } });
      if (res.ok) {
        toast.success(t("shell.product.adminImage.toast.refreshed"));
        onChanged?.({ imageUrl: res.imageUrl ?? null, imageSource: res.imageSource ?? null });
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
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
        {sourceBadge && currentImageUrl && (
          <span
            className="inline-flex items-center rounded-full bg-background/85 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur"
            title={sourceBadge}
          >
            {sourceBadge}
          </span>
        )}
        <button
          type="button"
          aria-label={t("shell.product.adminImage.menuLabel")}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setOpen((v) => !v);
          }}
          disabled={!!busy}
          className="grid h-7 w-7 place-items-center rounded-full bg-background/85 text-foreground shadow-card backdrop-blur transition active:scale-95 disabled:opacity-50"
        >
          {busy ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>

      {open && (
        <div
          className="absolute right-1.5 top-10 z-20 w-48 overflow-hidden rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-lg"
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={pickFile}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {t("shell.product.adminImage.actions.replace")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleRefresh}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t("shell.product.adminImage.actions.refresh")}
          </button>
          {currentImageUrl && (
            <button
              type="button"
              role="menuitem"
              onClick={handleRemove}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t("shell.product.adminImage.actions.remove")}
            </button>
          )}
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-elevated">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ImageIcon className="h-4 w-4" aria-hidden="true" />
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
            <p className="mt-2 truncate text-[11px] text-muted-foreground" title={preview.file.name}>
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
                {busy === "upload" ? t("shell.product.adminImage.preview.uploading") : t("shell.product.adminImage.preview.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
