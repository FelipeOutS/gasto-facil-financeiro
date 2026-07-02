/**
 * WA-PIX-UX-01 — Emissão e consumo de tokens opacos para "Copiar chave Pix".
 *
 * Motivação:
 *  - A resposta do WhatsApp para "qual a chave Pix do João?" mostra a chave
 *    mascarada. Para permitir cópia real, precisamos de um link autenticado.
 *  - O link nunca carrega a chave; apenas um token opaco de 32 bytes.
 *  - Guardamos apenas o SHA-256 do token (`token_hash`). O plaintext existe
 *    somente no link enviado uma única vez.
 *  - Escopado a (user_id, favorecido_id). TTL 10min. One-time reveal.
 *
 * Segurança/LGPD:
 *  - `whatsapp_pix_reveal_tokens` NUNCA armazena a chave Pix em texto plano.
 *  - Nenhum log inclui o token completo — apenas prefixo de 8 caracteres.
 *  - Consumo é atômico: marca `consumed_at` e retorna a chave uma vez.
 */
import { createHash, randomBytes } from "crypto";
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = _supabaseAdmin;

const TABLE = "whatsapp_pix_reveal_tokens";
const TTL_MINUTES = 10;

export type IssuedRevealToken = {
  token: string;
  expiresAt: string;
  tokenPrefix: string;
};

export type RevealPayload = {
  favorecidoNome: string;
  pixKey: string;
  pixKeyType: string;
};

export function hashRevealToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Gera um token opaco de 32 bytes (43 chars base64url) e persiste apenas seu hash.
 * Devolve o plaintext para uso único no link — nunca é lido de volta.
 */
export async function issueRevealToken(args: {
  userId: string;
  favorecidoId: string;
  pixKeyType: string;
}): Promise<IssuedRevealToken | null> {
  const { userId, favorecidoId, pixKeyType } = args;
  if (!userId || !favorecidoId) return null;

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashRevealToken(token);
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

  const { error } = await supabaseAdmin.from(TABLE).insert({
    user_id: userId,
    favorecido_id: favorecidoId,
    token_hash: tokenHash,
    pix_key_type: pixKeyType,
    expires_at: expiresAt,
  });

  if (error) return null;

  console.info({
    event: "wa_pix_reveal",
    stage: "issued",
    tokenPrefix: tokenHash.slice(0, 8),
  });

  return { token, expiresAt, tokenPrefix: tokenHash.slice(0, 8) };
}

/**
 * Consome o token e devolve a chave Pix do favorecido. One-time: se já foi
 * consumido, ou expirou, ou pertence a outro user, retorna null.
 */
export async function consumeRevealToken(args: {
  userId: string;
  token: string;
}): Promise<RevealPayload | null> {
  const { userId, token } = args;
  if (!userId || !token) return null;

  const tokenHash = hashRevealToken(token);

  const { data: row } = await supabaseAdmin
    .from(TABLE)
    .select("id, user_id, favorecido_id, expires_at, consumed_at")
    .eq("token_hash", tokenHash)
    .eq("user_id", userId)
    .maybeSingle();

  if (!row) {
    console.info({
      event: "wa_pix_reveal",
      stage: "consume_miss",
      tokenPrefix: tokenHash.slice(0, 8),
    });
    return null;
  }

  if (row.consumed_at) {
    console.info({
      event: "wa_pix_reveal",
      stage: "consume_replay",
      tokenPrefix: tokenHash.slice(0, 8),
    });
    return null;
  }

  const expiresAt = new Date(row.expires_at as string).getTime();
  if (expiresAt < Date.now()) {
    console.info({
      event: "wa_pix_reveal",
      stage: "consume_expired",
      tokenPrefix: tokenHash.slice(0, 8),
    });
    return null;
  }

  // Marca como consumido antes de ler a chave, para reduzir janela de replay.
  const { data: upd } = await supabaseAdmin
    .from(TABLE)
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();

  if (!upd) {
    // corrida — outra requisição pegou primeiro
    return null;
  }

  const { data: fav } = await supabaseAdmin
    .from("fornecedores")
    .select("id, nome, pix_key, pix_key_type, user_id")
    .eq("id", row.favorecido_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!fav || !fav.pix_key || !fav.pix_key_type) return null;

  console.info({
    event: "wa_pix_reveal",
    stage: "revealed",
    tokenPrefix: tokenHash.slice(0, 8),
    pixKeyType: fav.pix_key_type,
  });

  return {
    favorecidoNome: fav.nome as string,
    pixKey: fav.pix_key as string,
    pixKeyType: fav.pix_key_type as string,
  };
}

/** Housekeeping — apaga tokens expirados. Pode ser chamado por cron. */
export async function purgeExpiredRevealTokens(): Promise<void> {
  try {
    await supabaseAdmin
      .from(TABLE)
      .delete()
      .lt("expires_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  } catch {
    /* noop */
  }
}
