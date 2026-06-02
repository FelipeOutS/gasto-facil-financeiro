/**
 * Mercado Inteligente — envia preços de compras finalizadas para a base
 * `community_market_prices`.
 *
 * Regras importantes:
 * - Só é chamado APÓS o usuário confirmar a finalização da compra e escolher
 *   o mercado. Nada é salvo automaticamente sem confirmação.
 * - Itens sem preço válido são ignorados (continuam apenas no histórico local).
 * - Dedup por (user_id, normalized_product_name, lower(market_name), seen_at,
 *   coalesce(unit,'')). Se já existir, atualiza; senão, insere.
 * - Server-side, RLS aplica via auth-middleware.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ImageSourceSchema = z.enum([
  "open_food_facts",
  "joanin",
  "manual",
  "brand_logo",
  "none",
  "admin_upload",
]);

const ItemSchema = z.object({
  productName: z.string().trim().min(1).max(255),
  price: z.number().positive().max(1_000_000),
  unit: z.string().trim().max(32).optional().nullable(),
  category: z.string().trim().max(64).optional().nullable(),
  barcode: z
    .string()
    .trim()
    .max(32)
    .regex(/^[0-9A-Za-z._-]+$/)
    .optional()
    .nullable(),
  brand: z.string().trim().max(120).optional().nullable(),
  imageUrl: z.string().trim().url().max(2048).optional().nullable(),
  imageSource: ImageSourceSchema.optional().nullable(),
  imageConfidence: z.number().min(0).max(1).optional().nullable(),
});

const InputSchema = z.object({
  marketName: z.string().trim().min(1).max(120),
  source: z.enum(["store", "receipt"]),
  /** YYYY-MM-DD (local). */
  seenAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).optional().nullable(),
  items: z.array(ItemSchema).min(1).max(200),
});

export type SubmitPurchaseResult = {
  inserted: number;
  updated: number;
  skipped: number;
};

export const submitPurchaseToCommunityPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<SubmitPurchaseResult> => {
    const supabase = (context as { supabase: any; userId: string }).supabase;
    const userId = (context as { supabase: any; userId: string }).userId;

    const market = data.marketName.trim();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of data.items) {
      const productName = item.productName.trim();
      const normalized = productName.toLowerCase().replace(/\s+/g, " ");
      const unit = item.unit?.trim() || null;

      // Dedup: mesmo usuário, produto normalizado, mercado (case-insensitive),
      // mesma data (seen_at) e mesma unidade.
      let dupId: string | null = null;
      try {
        const { data: existing } = await supabase
          .from("community_market_prices")
          .select("id, unit")
          .eq("user_id", userId)
          .eq("normalized_product_name", normalized)
          .eq("seen_at", data.seenAt)
          .ilike("market_name", market)
          .limit(20);
        if (Array.isArray(existing)) {
          const match = existing.find(
            (r: { unit: string | null }) => (r.unit ?? null) === unit,
          );
          if (match) dupId = match.id as string;
        }
      } catch {
        // se a leitura falhar, seguimos com insert (RLS pode bloquear e isso vira skip)
      }

      const payload: Record<string, unknown> = {
        product_name: productName,
        normalized_product_name: normalized,
        price: item.price,
        unit,
        category: item.category?.trim() || null,
        market_name: market,
        source: data.source,
        seen_at: data.seenAt,
        notes: data.notes?.trim() || null,
        brand: item.brand?.trim() || null,
        barcode: item.barcode?.trim() || null,
        image_url: item.imageUrl?.trim() || null,
        image_source: item.imageSource ?? null,
        image_confidence:
          typeof item.imageConfidence === "number" ? item.imageConfidence : null,
        status: "active",
      };

      if (dupId) {
        const { error } = await supabase
          .from("community_market_prices")
          .update(payload)
          .eq("id", dupId)
          .eq("user_id", userId);
        if (error) skipped++;
        else updated++;
      } else {
        payload.user_id = userId;
        const { error } = await supabase
          .from("community_market_prices")
          .insert(payload);
        if (error) skipped++;
        else inserted++;
      }
    }

    return { inserted, updated, skipped };
  });
