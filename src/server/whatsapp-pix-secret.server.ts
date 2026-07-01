/**
 * WA-Q-PixInline-LGPD — Armazenamento transitório seguro da chave Pix
 * entre a prévia e a confirmação do fluxo inline.
 *
 * Motivação (LGPD):
 *  - A chave Pix (CPF, celular, e-mail, aleatória) é dado pessoal.
 *  - Ela NÃO pode ficar em texto plano em `whatsapp_messages.parsed`,
 *    `resposta_sugerida`, logs, `descricao` ou `observacao` de gasto,
 *    nem em audit logs. Precisa ficar disponível apenas o suficiente
 *    para persistir o favorecido após o "sim" e depois desaparecer.
 *
 * Solução:
 *  - Tabela dedicada `public.whatsapp_pix_pending_secrets` (service_role only,
 *    RLS ligada sem policy → deny-by-default no Data API).
 *  - AES-256-GCM com chave derivada de `WHATSAPP_PIX_KEY_ENC_SECRET`
 *    (segredo de ambiente 64 hex). IV aleatório por linha.
 *  - TTL de 30 min (default do schema). Deleção sempre atômica após
 *    confirmação, cancelamento, expiração ou desambiguação abandonada.
 *  - Nunca loga ciphertext nem plaintext — apenas contagens.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = _supabaseAdmin;

const TABLE = "whatsapp_pix_pending_secrets";
const ALGO = "aes-256-gcm";

/** Deriva chave AES-256 (32 bytes) do secret hex/qualquer string. */
function getKey(): Buffer {
  const raw = process.env.WHATSAPP_PIX_KEY_ENC_SECRET ?? "";
  if (!raw || raw.length < 32) {
    throw new Error("WHATSAPP_PIX_KEY_ENC_SECRET missing or too short");
  }
  // SHA-256 = 32 bytes → cabem 256 bits de chave AES.
  return createHash("sha256").update(raw, "utf8").digest();
}

/**
 * HMAC-SHA-256 da chave normalizada. Usado para dedup/lookup determinístico
 * sem armazenar plaintext. Sempre reversível para IGUALDADE, nunca para
 * recuperar o valor original.
 */
export function hashPixKey(pixKeyNormalized: string): string {
  const raw = process.env.WHATSAPP_PIX_KEY_ENC_SECRET ?? "";
  return createHmac("sha256", raw)
    .update(pixKeyNormalized.trim().toLowerCase())
    .digest("hex");
}

export type PendingPixSecretRef = {
  secretId: string;
  keyHash: string;
};

/**
 * Cifra e persiste a chave Pix. Retorna apenas o `secretId` (uuid) e
 * o `keyHash` (HMAC — não reversível). O plaintext some do processo.
 */
export async function storePendingPixKey(args: {
  userId: string;
  sessionMessageId: string;
  pixKeyPlaintext: string;
  pixKeyType: string;
}): Promise<PendingPixSecretRef | null> {
  const { userId, sessionMessageId, pixKeyPlaintext, pixKeyType } = args;
  if (!userId || !sessionMessageId || !pixKeyPlaintext) return null;

  let ciphertext: string;
  let ivB64: string;
  let tagB64: string;
  let keyHash: string;
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, getKey(), iv);
    const enc = Buffer.concat([
      cipher.update(pixKeyPlaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    ciphertext = enc.toString("base64");
    ivB64 = iv.toString("base64");
    tagB64 = tag.toString("base64");
    keyHash = hashPixKey(pixKeyPlaintext);
  } catch {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      user_id: userId,
      session_message_id: sessionMessageId,
      key_ciphertext: ciphertext,
      key_iv: ivB64,
      key_auth_tag: tagB64,
      key_hash: keyHash,
      key_type: pixKeyType,
    })
    .select("id")
    .maybeSingle();

  if (error || !data?.id) return null;
  return { secretId: data.id as string, keyHash };
}

/**
 * Lê a chave, apaga a linha, e devolve o plaintext.
 * Cumpre "usar uma vez e sumir". Falha silenciosamente (retorna null)
 * se a linha não existe, expirou, ou pertence a outro user_id.
 */
export async function consumePendingPixKey(args: {
  userId: string;
  secretId: string;
}): Promise<string | null> {
  const { userId, secretId } = args;
  if (!userId || !secretId) return null;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, user_id, key_ciphertext, key_iv, key_auth_tag, expires_at")
    .eq("id", secretId)
    .eq("user_id", userId) // defesa em profundidade sobre a RLS
    .maybeSingle();

  if (error || !data) return null;

  const expiresAt = data.expires_at ? new Date(data.expires_at as string).getTime() : 0;
  if (expiresAt && expiresAt < Date.now()) {
    // expirado — apaga e devolve null
    await deletePendingPixKey({ userId, secretId });
    return null;
  }

  let plaintext: string | null = null;
  try {
    const decipher = createDecipheriv(
      ALGO,
      getKey(),
      Buffer.from(data.key_iv as string, "base64"),
    );
    decipher.setAuthTag(Buffer.from(data.key_auth_tag as string, "base64"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(data.key_ciphertext as string, "base64")),
      decipher.final(),
    ]);
    plaintext = dec.toString("utf8");
  } catch {
    plaintext = null;
  }

  // Sempre apaga, mesmo em erro de descriptografia.
  await deletePendingPixKey({ userId, secretId });
  return plaintext;
}

/** Apaga uma linha específica. Idempotente. */
export async function deletePendingPixKey(args: {
  userId: string;
  secretId: string;
}): Promise<void> {
  const { userId, secretId } = args;
  if (!userId || !secretId) return;
  try {
    await supabaseAdmin
      .from(TABLE)
      .delete()
      .eq("id", secretId)
      .eq("user_id", userId);
  } catch {
    /* noop */
  }
}

/** Housekeeping — apaga linhas expiradas. Pode ser chamado por cron. */
export async function purgeExpiredPendingPixKeys(): Promise<void> {
  try {
    await supabaseAdmin
      .from(TABLE)
      .delete()
      .lt("expires_at", new Date().toISOString());
  } catch {
    /* noop */
  }
}
