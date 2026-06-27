/**
 * WA-C7 — Operações de banco para favorecidos (reuso da tabela `fornecedores`).
 *
 * Toda query inclui filtro explícito por `user_id` (defesa em profundidade
 * sobre a RLS, padrão WA-C5.1). Nada de Pix/CPF/CNPJ/telefone nos logs —
 * apenas IDs UUID, tipo da chave, contagem e flags booleanas.
 */
import * as _supa from "@/integrations/supabase/client.server";
import type { PixKeyType } from "./whatsapp-pix-parser";

// Live-binding para permitir mock.module() em testes (padrão WA-C3/WA-C4).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin: any = new Proxy({}, {
  get: (_t, prop) => {
    const sa = (_supa as { supabaseAdmin?: unknown }).supabaseAdmin;
    if (process.env.WA_PIX_DBG) console.log("[favorecidos proxy] prop=", String(prop), "sa typeof=", typeof sa, "has from:", !!(sa as { from?: unknown })?.from);
    return (sa as never)[prop as never];
  },
});

export type FavorecidoRow = {
  id: string;
  user_id: string;
  nome: string;
  apelido: string | null;
  pix_key: string | null;
  pix_key_type: PixKeyType | null;
};

function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Busca favorecidos do usuário cujo `nome` OU `apelido` casa (substring,
 * case/acento-insensitive) com o termo. Limit 10 — desambiguação humana.
 */
export async function findFavorecidosByNome(
  userId: string,
  termo: string,
): Promise<FavorecidoRow[]> {
  const n = norm(termo);
  if (!userId || !n) return [];
  const { data, error } = await supabaseAdmin
    .from("fornecedores")
    .select("id, user_id, nome, apelido, pix_key, pix_key_type")
    .eq("user_id", userId)
    .eq("ativo", true);
  if (error || !Array.isArray(data)) return [];
  const rows = data as FavorecidoRow[];
  // Match em memória: substring no nome OU apelido normalizados.
  const matches = rows.filter((r) => {
    const nn = norm(r.nome);
    const na = norm(r.apelido ?? "");
    return nn.includes(n) || (na.length > 0 && na.includes(n));
  });
  // Prioriza match exato.
  matches.sort((a, b) => {
    const aExact = norm(a.nome) === n || norm(a.apelido ?? "") === n;
    const bExact = norm(b.nome) === n || norm(b.apelido ?? "") === n;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
  return matches.slice(0, 10);
}

export type CreateFavorecidoInput = {
  userId: string;
  nome: string;
  pixKey?: string | null;
  pixKeyType?: PixKeyType | null;
};

export async function createFavorecido(
  input: CreateFavorecidoInput,
): Promise<FavorecidoRow | null> {
  const { data, error } = await supabaseAdmin
    .from("fornecedores")
    .insert({
      user_id: input.userId,
      nome: input.nome.trim(),
      pix_key: input.pixKey ?? null,
      pix_key_type: input.pixKeyType ?? null,
      ativo: true,
      source: "whatsapp",
    })
    .select("id, user_id, nome, apelido, pix_key, pix_key_type")
    .maybeSingle();
  if (error || !data) return null;
  return data as FavorecidoRow;
}

export async function updateFavorecidoPix(
  userId: string,
  favorecidoId: string,
  pixKey: string,
  pixKeyType: PixKeyType,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("fornecedores")
    .update({ pix_key: pixKey, pix_key_type: pixKeyType })
    .eq("id", favorecidoId)
    .eq("user_id", userId) // defesa em profundidade
    .select("id")
    .maybeSingle();
  return !error && !!data;
}

/**
 * Rotula o tipo de chave para exibição ao usuário.
 */
export function rotuloTipoPix(t: PixKeyType): string {
  switch (t) {
    case "email":
      return "e-mail";
    case "telefone":
      return "telefone";
    case "cpf":
      return "CPF";
    case "cnpj":
      return "CNPJ";
    case "aleatoria":
      return "chave aleatória";
    default:
      return "chave";
  }
}
