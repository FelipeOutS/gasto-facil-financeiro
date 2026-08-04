/**
 * WA-3.30 — Baixa ATÔMICA de conta a pagar via WhatsApp.
 *
 * Contrato:
 *   - `sim` deve criar EXATAMENTE 1 gasto + marcar conta como pago +
 *     vincular contas_a_pagar.gasto_id, tudo na mesma transação.
 *   - Valor R$ 119,90 permanece 119,90 (não 11.990).
 *   - Categoria/data/origem preservadas.
 *   - forma_pagamento herdada da conta quando definida; senão "outros".
 *   - Idempotência: dois `sim` → 1 gasto. Replay do webhook → 1 gasto.
 *   - Conta já paga com gasto_id válido → no-op (não cria novo gasto).
 *   - Conta paga sem gasto_id → erro controlado (NÃO cria gasto silenciosamente).
 *   - Falha na criação do gasto → conta permanece pendente.
 *   - Falha no update da conta → gasto é desfeito (rollback).
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { state, resetState, gastosInserts } from "./_whatsapp-fake";

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

function msg(texto: string, externalId = `ext-${Math.random().toString(36).slice(2, 10)}`) {
  return {
    external_id: externalId,
    telefone: "5511999998888",
    texto,
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
  } as const;
}

function makeConta(opts: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: opts.id ?? "c-internet",
    user_id: opts.user_id ?? "u1",
    nome: opts.nome ?? "Internet",
    valor: opts.valor ?? 119.9,
    data_vencimento: opts.data_vencimento ?? "2026-07-05",
    status: opts.status ?? "pendente",
    data_pagamento: opts.data_pagamento ?? null,
    categoria_id: opts.categoria_id ?? "cat-int",
    gasto_id: opts.gasto_id ?? null,
    recorrente: false,
    frequencia_recorrencia: null,
    recorrencia_id: null,
    forma_pagamento: opts.forma_pagamento ?? null,
    beneficiario: opts.beneficiario ?? null,
    ...opts,
  };
}

describe("WA-3.30 — baixa atômica: cria gasto + vincula", () => {
  beforeEach(() =>
    resetState({
      contas: [
        makeConta({ id: "c-internet", nome: "Internet", valor: 119.9, categoria_id: "cat-int" }),
      ],
    }),
  );

  it("confirmar baixa cria 1 gasto e liga conta.gasto_id", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet"));
    const out = await processarMensagemWhatsApp(msg("sim", "ext-sim"));
    expect(out.status).toBe("salva");

    const gastos = gastosInserts();
    expect(gastos.length).toBe(1);
    expect(gastos[0].row.valor).toBe(119.9);
    expect(gastos[0].row.descricao).toBe("Internet");
    expect(gastos[0].row.categoria_id).toBe("cat-int");
    expect(gastos[0].row.origem).toBe("whatsapp");

    const conta = state.contasData[0];
    expect(conta.status).toBe("pago");
    expect(conta.gasto_id).toBe(gastos[0].row.id);
  });

  it("valor R$ 119,90 permanece 119,90 (não 11.990)", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet"));
    await processarMensagemWhatsApp(msg("sim", "ext-v"));
    const g = gastosInserts()[0]!.row;
    expect(g.valor).toBe(119.9);
    expect(g.valor).not.toBe(11990);
  });

  it("categoria, data e origem preservadas", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet"));
    await processarMensagemWhatsApp(msg("sim", "ext-c"));
    const g = gastosInserts()[0]!.row;
    expect(g.categoria_id).toBe("cat-int");
    expect(g.origem).toBe("whatsapp");
    expect(typeof g.data).toBe("string");
    expect((g.data as string).length).toBe(10);
  });

  it("dois 'sim' criam um único gasto", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet"));
    await processarMensagemWhatsApp(msg("sim", "ext-1"));
    await processarMensagemWhatsApp(msg("sim", "ext-2"));
    expect(gastosInserts().length).toBe(1);
    expect(state.contasData[0].status).toBe("pago");
  });

  it("replay do mesmo webhook não duplica", async () => {
    await processarMensagemWhatsApp(msg("paguei a internet"));
    const ext = "ext-replay";
    await processarMensagemWhatsApp(msg("sim", ext));
    await processarMensagemWhatsApp(msg("sim", ext));
    await processarMensagemWhatsApp(msg("sim", ext));
    expect(gastosInserts().length).toBe(1);
  });
});

describe("WA-3.30 — idempotência e inconsistência", () => {
  it("conta já paga com gasto_id válido: no-op, sem novo gasto", async () => {
    resetState({
      contas: [
        makeConta({
          id: "c-internet",
          nome: "Internet",
          status: "pago",
          data_pagamento: "2026-07-02",
          gasto_id: "g-existing",
        }),
      ],
      gastos: [
        {
          id: "g-existing",
          user_id: "u1",
          descricao: "Internet",
          valor: 119.9,
          data: "2026-07-02",
          categoria_id: "cat-int",
          forma_pagamento: "outros",
          mes: 7,
          ano: 2026,
          tipo_gasto: "unico",
          confirmado: true,
          origem: "whatsapp",
          estabelecimento: "",
        },
      ],
    });
    // Nesse estado, findVencimentoByTerm não retorna a conta (só pendentes).
    // Simulando a chamada direta via RPC teria retornado noop, mas o fluxo
    // real nem chega lá; validamos que nada muda.
    const out = await processarMensagemWhatsApp(msg("paguei a internet"));
    expect(out.status).toBe("consulta");
    expect(gastosInserts().length).toBe(0);
    expect(state.contasData.length).toBe(1);
  });

  it("conta paga sem gasto_id: RPC devolve 'inconsistent' e não cria gasto", async () => {
    // Chamamos a RPC diretamente para cobrir o branch, já que o fluxo
    // conversacional filtra conta paga antes.
    resetState({
      contas: [
        makeConta({
          id: "c-internet",
          nome: "Internet",
          status: "pago",
          data_pagamento: "2026-07-02",
          gasto_id: null,
        }),
      ],
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("whatsapp_baixa_conta_atomic", {
      p_user_id: "u1",
      p_conta_id: "c-internet",
      p_data_pagamento: "2026-07-03",
      p_origem: "whatsapp",
    });
    const res = Array.isArray(data) ? data[0] : data;
    expect(res.result).toBe("inconsistent");
    expect(gastosInserts().length).toBe(0);
  });
});

describe("WA-3.30 — forma_pagamento herdada quando definida", () => {
  it("herda forma_pagamento da conta se definida", async () => {
    resetState({
      contas: [makeConta({ id: "c-internet", forma_pagamento: "pix" })],
    });
    await processarMensagemWhatsApp(msg("paguei a internet"));
    await processarMensagemWhatsApp(msg("sim", "ext-fp"));
    expect(gastosInserts()[0]!.row.forma_pagamento).toBe("pix");
  });

  it("default 'outros' quando conta não tem forma_pagamento", async () => {
    resetState({ contas: [makeConta({ id: "c-internet", forma_pagamento: null })] });
    await processarMensagemWhatsApp(msg("paguei a internet"));
    await processarMensagemWhatsApp(msg("sim", "ext-fp2"));
    expect(gastosInserts()[0]!.row.forma_pagamento).toBe("outros");
  });
});
