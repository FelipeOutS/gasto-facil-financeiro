import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Server-only. Recipient is always obtained from the verified Auth identity.
const db = supabaseAdmin;
async function identity(client: typeof supabaseAdmin, expected: string) {
  const { data, error } = await client.auth.getUser();
  if (
    error ||
    !data.user ||
    data.user.id !== expected ||
    !data.user.email ||
    !data.user.email_confirmed_at
  )
    throw Error("email_nao_verificado");
  return data.user.email;
}
async function digest(user: string, nonce: string, code: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw Error("email_indisponivel");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, enc.encode(JSON.stringify([user, nonce, code]))),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function delivery(to: string, nonce: string, code: string) {
  const text = `Seu código do Cofre é ${code}. Expira em 10 minutos e funciona uma vez. Ele não substitui sua chave de recuperação ou dispositivo autorizado. Se não solicitou, ignore.`;
  return {
    to,
    from: "Gasto Inteligente <no-reply@notify.gastointeligente.com.br>",
    sender_domain: "notify.gastointeligente.com.br",
    subject: "Código de recuperação do Cofre",
    html: `<p>${text}</p>`,
    text,
    purpose: "transactional",
    label: "vault-recovery-code",
    idempotency_key: `vault:${nonce}:code`,
    message_id: nonce,
  };
}
export async function vaultEmail(
  action: "begin" | "verify" | "notify",
  client: typeof supabaseAdmin,
  user: string,
  args: { vault: string; nonce?: string; code?: string },
) {
  const email = await identity(client, user);
  if (action === "begin") {
    const nonce = crypto.randomUUID();
    // Rejection sampling: no modulo bias in six-digit codes.
    const n = new Uint32Array(1);
    do {
      crypto.getRandomValues(n);
    } while (n[0] >= 4294000000);
    const code = String(n[0] % 1000000).padStart(6, "0");
    const { data, error } = await db.rpc(
      "vault_v2_email_begin" as never,
      {
        p_user: user,
        p_vault: args.vault,
        p_nonce: nonce,
        p_hash: await digest(user, nonce, code),
        p_email: email,
        p_delivery: delivery(email, nonce, code),
      } as never,
    );
    if (error || data !== true) throw Error("email_limite");
    return { nonce };
  }
  if (!args.nonce) throw Error("codigo_invalido");
  if (action === "verify") {
    if (!/^\d{6}$/.test(args.code ?? "")) throw Error("codigo_invalido");
    const { data, error } = await db.rpc(
      "vault_v2_email_verify" as never,
      {
        p_user: user,
        p_nonce: args.nonce,
        p_hash: await digest(user, args.nonce, args.code!),
        p_email: email,
      } as never,
    );
    if (error || data !== true) throw Error("codigo_invalido");
    return { verified: true };
  }
  const { data, error } = await supabaseAdmin
    .from("vault_v2_email_challenges" as never)
    .select("consumed_at")
    .eq("user_id", user)
    .eq("nonce", args.nonce)
    .eq("vault_id", args.vault)
    .maybeSingle();
  if (error || !(data as { consumed_at?: string } | null)?.consumed_at)
    throw Error("codigo_invalido");
  // Notification is durably queued IN the password replacement transaction.
  return { notification: "queued" };
}
