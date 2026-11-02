/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import {
  CONTA_GASTO_ORIGEM,
  ContaGastoExcluidoError,
  MSG_PAGAR_GASTO_EXCLUIDO,
  estornarPagamentoConta,
  findLinkedGastos,
  hasDeletedLinkedGasto,
  normalizedText,
  opId,
} from "./contas-estorno";

const formaSchema = z.enum([
  "pix",
  "dinheiro",
  "debito",
  "credito",
  "boleto",
  "transferencia",
  "vale_alimentacao",
  "vale_refeicao",
  "outro",
]);

const paymentInputSchema = z.object({
  id: z.string().uuid(),
  criarGasto: z.boolean().optional(),
  formaPagamento: formaSchema.optional(),
  dataPagamento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  observacao: z.string().optional(),
  nome: z.string().optional(),
  valor: z.number().positive().optional(),
  categoriaId: z.string().optional(),
  mesReferencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

function isFaturaName(nome: string): boolean {
  const n = normalizedText(nome);
  return /\bfatura\b/.test(n) || /\bcart[aã]o\b/.test(n);
}

const unpayInputSchema = z.object({
  id: z.string().uuid(),
  removerGastoVinculado: z.boolean().optional(),
});




function monthYear(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return { mes: d.getMonth() + 1, ano: d.getFullYear() };
}

async function categoriaUuidFor(sb: any, userId: string, categoriaId?: string | null) {
  if (!categoriaId) return null;
  const uuidLike =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(categoriaId);
  const query = sb.from("categorias").select("id").eq("user_id", userId).limit(1);
  const { data, error } = uuidLike
    ? await query.eq("id", categoriaId).maybeSingle()
    : await query.eq("legacy_id", categoriaId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

async function resolveContaAlerts(sb: any, userId: string, contaId: string) {
  const now = new Date().toISOString();
  await sb
    .from("user_alerts")
    .update({ status: "resolved", resolved_at: now, updated_at: now })
    .eq("user_id", userId)
    .eq("related_entity_type", "conta_a_pagar")
    .eq("related_entity_id", contaId)
    .in("status", ["unread", "read"]);
}


export const markContaAPagarPaid = createServerFn({ method: "POST" })
  .inputValidator((input) => paymentInputSchema.parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const userId = context.userId;
    const { assertFeatureAccess } = await import("@/server/feature-gate.server");
    await assertFeatureAccess(userId, "contas_a_pagar");
    const { data: conta, error: contaErr } = await sb
      .from("contas_a_pagar")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (contaErr) throw new Error(contaErr.message);
    if (!conta) throw new Error("Conta não encontrada.");

    const dataPagamento = data.dataPagamento ?? new Date().toISOString().slice(0, 10);
    const nome = (data.nome ?? conta.nome).trim() || conta.nome;
    const valor =
      typeof data.valor === "number" && data.valor > 0 ? data.valor : Number(conta.valor);
    const formaPagamento = data.formaPagamento ?? conta.forma_pagamento ?? "pix";
    const categoriaId = data.categoriaId ?? conta.categoria_id ?? null;
    const categoriaUuid = await categoriaUuidFor(sb, userId, categoriaId);
    const now = new Date().toISOString();
    let gastoId: string | null = conta.gasto_id ?? null;
    let createdGastoId: string | null = null;

    try {
      // Mês de referência (competência) — fonte da verdade.
      const mesRefInput =
        data.mesReferencia ??
        (typeof conta.mes_referencia === "string" && /^\d{4}-\d{2}$/.test(conta.mes_referencia)
          ? conta.mes_referencia
          : null);
      const ymPag = monthYear(dataPagamento);
      const invoiceMonth = mesRefInput ?? `${ymPag.ano}-${String(ymPag.mes).padStart(2, "0")}`;
      const [refAnoStr, refMesStr] = invoiceMonth.split("-");
      const refAno = Number(refAnoStr);
      const refMes = Number(refMesStr);

      // Anti-duplicidade fatura×conta: se a conta parece ser pagamento de
      // fatura de cartão, tentamos vincular à fatura existente do mês de
      // referência ao invés de criar um gasto duplicado (a fatura já tem os
      // gastos do cartão lançados individualmente).
      let faturaVinculada = false;
      if (data.criarGasto && isFaturaName(nome)) {
        const { data: faturas } = await sb
          .from("faturas_cartao")
          .select("id, valor_pago, status")
          .eq("user_id", userId)
          .eq("mes", refMes)
          .eq("ano", refAno);
        const candidata = (faturas ?? []).find((f: any) => f.status !== "paga");
        if (candidata) {
          await sb
            .from("faturas_cartao")
            .update({
              status: "paga",
              data_pagamento: dataPagamento,
              valor_pago: valor,
              updated_at: now,
            })
            .eq("id", candidata.id)
            .eq("user_id", userId);
          faturaVinculada = true;
        }
      }

      if (data.criarGasto && !faturaVinculada) {
        const linked = await findLinkedGastos(sb, userId, conta, nome, valor, dataPagamento);
        // Gasto vinculado soft-excluído: não atualiza nem recria (evita duplicata após restaurar).
        if (await hasDeletedLinkedGasto(sb, userId, conta, linked)) {
          throw new ContaGastoExcluidoError(MSG_PAGAR_GASTO_EXCLUIDO);
        }
        const existing = linked[0];
        const duplicateIds = linked.slice(1).map((g) => g.id);
        const gastoRow = {
          descricao: nome,
          valor,
          data: dataPagamento,
          estabelecimento: nome,
          categoria_id: categoriaUuid,
          forma_pagamento: formaPagamento,
          observacao: data.observacao ?? conta.observacao ?? null,
          mes: ymPag.mes,
          ano: ymPag.ano,
          confirmado: true,
          tipo_gasto: "unico",
          origem: CONTA_GASTO_ORIGEM,
          id_operacao_banco: opId(conta.id),
          invoice_month: invoiceMonth,
          fornecedor_id: conta.fornecedor_id ?? null,
          updated_at: now,
        };

        if (existing) {
          const { error } = await sb
            .from("gastos")
            .update(gastoRow)
            .eq("id", existing.id)
            .eq("user_id", userId);
          if (error) throw new Error(error.message);
          gastoId = existing.id;
          if (duplicateIds.length > 0) {
            const { error: dupErr } = await sb
              .from("gastos")
              .delete()
              .eq("user_id", userId)
              .in("id", duplicateIds);
            if (dupErr) throw new Error(dupErr.message);
          }
        } else {
          const newId = crypto.randomUUID();
          const { error } = await sb
            .from("gastos")
            .insert({ id: newId, user_id: userId, ...gastoRow, created_at: now });
          if (error) throw new Error(error.message);
          gastoId = newId;
          createdGastoId = newId;
        }
      }

      const { error: updateErr } = await sb
        .from("contas_a_pagar")
        .update({
          nome,
          valor,
          categoria_id: categoriaUuid,
          forma_pagamento: formaPagamento,
          status: "pago",
          data_pagamento: dataPagamento,
          gasto_id: gastoId,
          updated_at: now,
        })
        .eq("id", conta.id)
        .eq("user_id", userId);
      if (updateErr) throw new Error(updateErr.message);
      await resolveContaAlerts(sb, userId, conta.id);
    } catch (error) {
      if (createdGastoId) {
        await sb.from("gastos").delete().eq("id", createdGastoId).eq("user_id", userId);
      }
      throw error;
    }

    return {
      gastoId: gastoId ?? undefined,
      dataPagamento,
      nome,
      valor,
      categoriaId: data.categoriaId,
      formaPagamento,
    };
  });

export const unmarkContaAPagarPaid = createServerFn({ method: "POST" })
  .inputValidator((input) => unpayInputSchema.parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const userId = context.userId;
    const { assertFeatureAccess } = await import("@/server/feature-gate.server");
    await assertFeatureAccess(userId, "contas_a_pagar");
    return estornarPagamentoConta(sb, userId, data);
  });
