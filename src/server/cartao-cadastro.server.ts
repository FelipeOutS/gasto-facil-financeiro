/**
 * Criação de cartão pelo servidor (WhatsApp conversacional e WhatsApp Flow).
 *
 * Grava na MESMA tabela `cartoes` usada pelo site — não existe cartão
 * "do WhatsApp". Como o cliente com privilégio de servidor ignora as regras
 * de acesso do banco, este módulo reproduz explicitamente cada verificação
 * que o site teria:
 *   1. número do WhatsApp vinculado e ativo para ESTE usuário;
 *   2. usuário derivado do vínculo (nunca de payload do Flow);
 *   3. recurso de cartões liberado no plano (`cartoes_basico`, igual à RLS);
 *   4. ownership: grava sempre com `user_id` do usuário verificado;
 *   5. limite de cartões do plano gratuito: o gatilho do banco
 *      (`tg_free_ads_quota_cartoes`) roda também para o servidor;
 *   6. validação compartilhada (`@/lib/cartao-validacao`);
 *   7. duplicidade por nome normalizado;
 *   8. idempotência: id do cartão derivado da chave do pedido.
 */
import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encontrarCartaoDuplicado, validarCartao, type CampoCartao } from "@/lib/cartao-validacao";

export const COR_PADRAO_CARTAO = "#820ad1";

export type CartaoCriado = {
  id: string;
  nome: string;
  limiteTotal: number;
  diaFechamento: number;
  diaVencimento: number;
};

export type CriarCartaoResultado =
  | { status: "criado"; cartao: CartaoCriado }
  | { status: "ja_criado"; cartao: CartaoCriado }
  | { status: "duplicado"; existente: { id: string; nome: string } }
  | { status: "invalido"; erros: Partial<Record<CampoCartao, string>> }
  | { status: "sem_vinculo" }
  | { status: "sem_permissao" }
  | { status: "limite_plano" }
  | { status: "erro" };

type AdminLike = typeof supabaseAdmin;

/** UUID determinístico (formato v5) a partir da chave do pedido. */
export function cartaoIdParaPedido(userId: string, requestKey: string): string {
  const h = createHash("sha256").update(`wa-cartao:${userId}:${requestKey}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function telefoneCandidatos(telefone: string): string[] {
  const digits = telefone.replace(/\D/g, "");
  const c = new Set<string>([telefone, digits]);
  if (digits.startsWith("55")) c.add(digits.slice(2));
  else if (digits) c.add(`55${digits}`);
  return Array.from(c);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCriado(row: any): CartaoCriado {
  return {
    id: String(row.id),
    nome: String(row.nome),
    limiteTotal: Number(row.limite_total ?? 0),
    diaFechamento: Number(row.dia_fechamento ?? 1),
    diaVencimento: Number(row.dia_vencimento ?? 10),
  };
}

export async function criarCartaoViaWhatsApp(
  args: {
    userId: string;
    telefone: string;
    requestKey: string;
    dados: { nome: unknown; limite: unknown; diaFechamento: unknown; diaVencimento: unknown };
  },
  admin: AdminLike = supabaseAdmin,
): Promise<CriarCartaoResultado> {
  const { userId, telefone, requestKey } = args;
  if (!userId || !telefone || !requestKey) return { status: "sem_vinculo" };

  // 1/2. Vínculo ativo do número com ESTE usuário.
  const { data: link, error: linkErr } = await admin
    .from("whatsapp_links")
    .select("user_id, ativo, opt_in_em, revogado_em")
    .in("telefone", telefoneCandidatos(telefone))
    .limit(1)
    .maybeSingle();
  if (linkErr) return { status: "erro" };
  if (!link || link.user_id !== userId || !link.ativo || !link.opt_in_em || link.revogado_em) {
    return { status: "sem_vinculo" };
  }

  // 3. Mesmo critério da regra de acesso do banco para gravar cartões.
  const { data: podeCartoes, error: featErr } = await admin.rpc("has_feature_access", {
    _user_id: userId,
    _feature: "cartoes_basico",
  });
  if (featErr) return { status: "erro" };
  if (podeCartoes !== true) return { status: "sem_permissao" };

  // 6. Validação compartilhada.
  const v = validarCartao(args.dados);
  if (!v.ok) return { status: "invalido", erros: v.erros };

  const id = cartaoIdParaPedido(userId, requestKey);

  // 8. Idempotência: o mesmo pedido já criou este cartão.
  const { data: existentes, error: listErr } = await admin
    .from("cartoes")
    .select("id, nome, limite_total, dia_fechamento, dia_vencimento, user_id")
    .eq("user_id", userId);
  if (listErr) return { status: "erro" };
  const lista = (existentes ?? []) as Array<{ id: string; nome: string; user_id: string }>;
  const mesmoPedido = lista.find((c) => c.id === id);
  if (mesmoPedido) return { status: "ja_criado", cartao: toCriado(mesmoPedido) };

  // 7. Duplicidade por nome.
  const dup = encontrarCartaoDuplicado(v.valor.nome, lista);
  if (dup) return { status: "duplicado", existente: { id: dup.id, nome: dup.nome } };

  // 4/5. Grava com o user_id verificado; gatilho do banco aplica a cota.
  const row = {
    id,
    user_id: userId,
    nome: v.valor.nome,
    banco: "",
    limite_total: v.valor.limiteTotal,
    dia_fechamento: v.valor.diaFechamento,
    dia_vencimento: v.valor.diaVencimento,
    cor: COR_PADRAO_CARTAO,
    observacao: null,
  };
  const { error } = await admin.from("cartoes").insert(row);
  if (error) {
    const msg = String((error as { message?: string }).message ?? "");
    if (msg.includes("free_ads_quota_exceeded")) return { status: "limite_plano" };
    if ((error as { code?: string }).code === "23505") {
      const { data: again } = await admin
        .from("cartoes")
        .select("id, nome, limite_total, dia_fechamento, dia_vencimento, user_id")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (again) return { status: "ja_criado", cartao: toCriado(again) };
    }
    console.error({ event: "wa_cartao_create_failed", errorCode: (error as { code?: string }).code ?? null });
    return { status: "erro" };
  }
  return { status: "criado", cartao: toCriado(row) };
}
