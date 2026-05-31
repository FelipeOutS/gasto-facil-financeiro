/**
 * Mercado Inteligente — busca de mercados próximos
 * ----------------------------------------------------------------------------
 * Server function que chama o Google Places API (New) via Lovable connector
 * gateway. NUNCA expõe a chave para o client e NUNCA loga payload completo.
 *
 * Endpoint: POST /places/v1/places:searchNearby
 * Docs: https://developers.google.com/maps/documentation/places/web-service/nearby-search
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

const InputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().min(50).max(50000).default(2500),
});

export type NearbyMarket = {
  placeId: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  userRatingCount: number | null;
  businessStatus: string | null;
  googleMapsUri: string | null;
};

export type NearbyMarketsResult = {
  markets: NearbyMarket[];
  error: string | null;
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.googleMapsUri",
].join(",");

export const searchNearbyMarkets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<NearbyMarketsResult> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!lovableKey) {
      console.error("[nearby-markets] LOVABLE_API_KEY not configured");
      return { markets: [], error: "maps_not_configured" };
    }
    if (!mapsKey) {
      console.error("[nearby-markets] GOOGLE_MAPS_API_KEY not configured");
      return { markets: [], error: "maps_not_configured" };
    }

    try {
      const res = await fetch(`${GATEWAY_URL}/places/v1/places:searchNearby`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": mapsKey,
          "Content-Type": "application/json",
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify({
          includedTypes: ["supermarket", "grocery_store"],
          maxResultCount: 20,
          rankPreference: "DISTANCE",
          locationRestriction: {
            circle: {
              center: {
                latitude: data.latitude,
                longitude: data.longitude,
              },
              radius: data.radiusMeters,
            },
          },
        }),
      });

      if (!res.ok) {
        console.error(
          `[nearby-markets] places searchNearby failed: ${res.status}`,
        );
        return { markets: [], error: "places_request_failed" };
      }

      const json = (await res.json()) as {
        places?: Array<{
          id?: string;
          displayName?: { text?: string };
          formattedAddress?: string;
          location?: { latitude?: number; longitude?: number };
          rating?: number;
          userRatingCount?: number;
          businessStatus?: string;
          googleMapsUri?: string;
        }>;
      };

      const markets: NearbyMarket[] = (json.places ?? [])
        .filter((p) => typeof p.id === "string" && p.id.length > 0)
        .map((p) => ({
          placeId: p.id as string,
          name: p.displayName?.text?.trim() || "—",
          address: p.formattedAddress?.trim() || null,
          latitude:
            typeof p.location?.latitude === "number" ? p.location.latitude : null,
          longitude:
            typeof p.location?.longitude === "number"
              ? p.location.longitude
              : null,
          rating: typeof p.rating === "number" ? p.rating : null,
          userRatingCount:
            typeof p.userRatingCount === "number" ? p.userRatingCount : null,
          businessStatus:
            typeof p.businessStatus === "string" ? p.businessStatus : null,
          googleMapsUri:
            typeof p.googleMapsUri === "string" ? p.googleMapsUri : null,
        }));

      return { markets, error: null };
    } catch (err) {
      console.error(
        "[nearby-markets] unexpected error",
        err instanceof Error ? err.message : "unknown",
      );
      return { markets: [], error: "places_request_failed" };
    }
  });
