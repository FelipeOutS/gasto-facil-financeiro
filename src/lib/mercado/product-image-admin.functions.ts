/**
 * Mercado Inteligente — gerenciamento de imagens de produto pelo Admin Master.
 *
 * Server functions seguras para:
 *  - setProductImageAdmin: faz upload manual e salva no banco
 *    (image_source = 'admin_upload', confidence = 1).
 *  - removeProductImageAdmin: limpa imagem do banco e remove do bucket.
 *  - refreshProductImageAdmin: dispara busca automática novamente.
 *
 * Todas validam que o usuário é Admin Master (full access) e usam
 * `supabaseAdmin` para gravar/remover no Storage e no banco. Uploads
 * passam por validação dura de mime-type, tamanho (3 MB) e a URL final
 * volta a passar pela whitelist antes de ser persistida.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { validateImageUrl } from "./image-url-whitelist";
import { lookupProductImage } from "./product-image.functions";
import { toPersistableImage } from "./product-image-persist";

const ADMIN_MASTER_EMAILS = [
  "felipe.out.silva@outlook.com",
  "michael@medeiroscenografia.com.br",
] as const;

const BUCKET = "mercado-product-images";
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function ensureAdminMaster(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data?.user) throw new Error("FORBIDDEN");
  const email = (data.user.email ?? "").trim().toLowerCase();
  if (!ADMIN_MASTER_EMAILS.includes(email as (typeof ADMIN_MASTER_EMAILS)[number])) {
    // Fallback: também aceita owner role.
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isOwner = (roles ?? []).some((r: { role: string }) => r.role === "owner");
    if (!isOwner) throw new Error("FORBIDDEN");
  }
}

function decodeBase64(b64: string): Uint8Array {
  // Aceita data URL ou base64 puro.
  const cleaned = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(cleaned);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function buildStoragePath(priceId: string, ext: string): string {
  const safeId = priceId.replace(/[^a-zA-Z0-9_-]/g, "");
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `products/${safeId}/${ts}-${rand}.${ext}`;
}

function extractBucketPath(publicUrl: string): string | null {
  const v = validateImageUrl(publicUrl);
  if (!v.ok || v.origin !== "admin_upload") return null;
  try {
    const u = new URL(v.url);
    const prefix = "/storage/v1/object/public/mercado-product-images/";
    if (!u.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(u.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* setProductImageAdmin                                                       */
/* -------------------------------------------------------------------------- */

const SetInputSchema = z.object({
  priceId: z.string().uuid(),
  fileBase64: z.string().min(16).max(6_000_000), // ~3MB * 1.34 base64
  mimeType: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
  originalFileName: z.string().trim().max(200).optional(),
});

export type SetProductImageResult = {
  ok: true;
  imageUrl: string;
  imageSource: "admin_upload";
};

export const setProductImageAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<SetProductImageResult> => {
    await ensureAdminMaster(context.userId);

    const bytes = decodeBase64(data.fileBase64);
    if (bytes.byteLength === 0) throw new Error("EMPTY_FILE");
    if (bytes.byteLength > MAX_BYTES) throw new Error("FILE_TOO_LARGE");

    const ext = MIME_TO_EXT[data.mimeType];
    if (!ext) throw new Error("INVALID_MIME");

    // Verifica se o priceId existe (evita upload órfão).
    const { data: priceRow, error: priceErr } = await supabaseAdmin
      .from("community_market_prices")
      .select("id, image_url")
      .eq("id", data.priceId)
      .single();
    if (priceErr || !priceRow) throw new Error("PRICE_NOT_FOUND");

    const path = buildStoragePath(data.priceId, ext);

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: data.mimeType,
        cacheControl: "3600",
        upsert: false,
      });
    if (upErr) {
      console.error("[setProductImageAdmin] upload", upErr.message);
      throw new Error("UPLOAD_FAILED");
    }

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub?.publicUrl ?? "";
    const v = validateImageUrl(publicUrl);
    if (!v.ok || v.origin !== "admin_upload") {
      // Limpa arquivo órfão se a URL não bater na whitelist.
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      throw new Error("INVALID_PUBLIC_URL");
    }

    // Remove imagem anterior se também era admin_upload (evita lixo).
    const prevPath = priceRow.image_url ? extractBucketPath(priceRow.image_url) : null;
    if (prevPath && prevPath !== path) {
      await supabaseAdmin.storage.from(BUCKET).remove([prevPath]);
    }

    const { error: updErr } = await supabaseAdmin
      .from("community_market_prices")
      .update({
        image_url: v.url,
        image_source: "admin_upload",
        image_confidence: 1,
      })
      .eq("id", data.priceId);
    if (updErr) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      throw new Error("DB_UPDATE_FAILED");
    }

    return { ok: true, imageUrl: v.url, imageSource: "admin_upload" };
  });

/* -------------------------------------------------------------------------- */
/* removeProductImageAdmin                                                    */
/* -------------------------------------------------------------------------- */

const RemoveInputSchema = z.object({ priceId: z.string().uuid() });

export const removeProductImageAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RemoveInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureAdminMaster(context.userId);

    const { data: row } = await supabaseAdmin
      .from("community_market_prices")
      .select("id, image_url")
      .eq("id", data.priceId)
      .single();

    if (!row) throw new Error("PRICE_NOT_FOUND");

    const prevPath = row.image_url ? extractBucketPath(row.image_url) : null;
    if (prevPath) {
      await supabaseAdmin.storage.from(BUCKET).remove([prevPath]);
    }

    const { error: updErr } = await supabaseAdmin
      .from("community_market_prices")
      .update({
        image_url: null,
        image_source: null,
        image_confidence: null,
      })
      .eq("id", data.priceId);
    if (updErr) throw new Error("DB_UPDATE_FAILED");

    return { ok: true as const };
  });

/* -------------------------------------------------------------------------- */
/* refreshProductImageAdmin                                                   */
/* -------------------------------------------------------------------------- */

const RefreshInputSchema = z.object({
  priceId: z.string().uuid(),
  force: z.boolean().optional(),
});

export const refreshProductImageAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RefreshInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureAdminMaster(context.userId);

    const { data: row, error } = await supabaseAdmin
      .from("community_market_prices")
      .select("id, product_name, brand, barcode, category, image_url, image_source")
      .eq("id", data.priceId)
      .single();
    if (error || !row) throw new Error("PRICE_NOT_FOUND");

    // Nunca sobrescreve admin_upload automaticamente sem `force`.
    if (row.image_source === "admin_upload" && !data.force) {
      return { ok: false as const, reason: "admin_upload_protected" };
    }

    const result = await lookupProductImage({
      data: {
        productName: row.product_name,
        brand: row.brand ?? null,
        barcode: row.barcode ?? null,
        category: (row.category ?? null) as never,
      },
    });

    const persistable = toPersistableImage(result);
    if (!persistable.image_url) {
      return { ok: false as const, reason: "no_match" };
    }

    const { error: updErr } = await supabaseAdmin
      .from("community_market_prices")
      .update(persistable)
      .eq("id", data.priceId);
    if (updErr) throw new Error("DB_UPDATE_FAILED");

    return {
      ok: true as const,
      imageUrl: persistable.image_url,
      imageSource: persistable.image_source,
    };
  });
