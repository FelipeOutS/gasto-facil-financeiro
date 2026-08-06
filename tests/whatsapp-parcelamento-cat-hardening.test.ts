/**
 * WA-F3.3-Fix-CatHardening — categoria escolhida manualmente DEVE ser a
 * categoria persistida nas 6 parcelas e na memória de merchant. Sem isso,
 * o smoke test 3.12 mostrou Geladeira (manual=Casa) saindo como Mercado.
 *
 * Suíte cobre:
 *  - manual → todas as parcelas com mesma categoria_id e memória com mesma id;
 *  - sugerida (sem ajuste) → comportamento atual preservado;
 *  - readback falha se categoria de qualquer parcela divergir do esperado;
 *  - manual inválida (categoria não existe mais) aborta com erro, não cai em sugestão;
 *  - retry/idempotência: mesmo external_id não duplica grupo nem parcelas.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import "./_whatsapp-fake";
import {
  resetState,
  state,
  gastosInserts,
  fakeAdmin,
  setupWhatsAppFakeMocks,
} from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");

function msg(texto: string, externalId = "e-1") {
  return {
    external_id: externalId,
    telefone: "5511999998888",
    texto,
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
  };
}

function nubank() {
  return {
    id: "c-nu",
    nome: "Nubank",
    banco: "Nubank",
    limite_total: 0,
    dia_fechamento: 1,
    dia_vencimento: 10,
    cor: "#000",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function memoryInserts() {
  return state.inserts.filter((i) => i.table === "whatsapp_merchant_category_memories");
}

describe("WA-F3.3-Fix-CatHardening", () => {
  beforeEach(() =>
    resetState({
      cartoes: [nubank()],
      categorias: [
        { id: "cat-out", legacy_id: "outros", nome: "Outros", user_id: "u1" },
        { id: "cat-mer", legacy_id: "mercado", nome: "Mercado", user_id: "u1" },
        { id: "cat-casa", legacy_id: "casa", nome: "Casa", user_id: "u1" },
      ],
    }),
  );

  it("categoria manual (Casa) → todas as 6 parcelas persistem com cat-casa", async () => {
    // Geladeira reproduz o cenário real do smoke test 3.12.
    await processarMensagemWhatsApp(msg("Geladeira 1200 em 6x no Nubank", "e-1"));
    await processarMensagemWhatsApp(msg("categoria Casa", "e-2"));
    const out = await processarMensagemWhatsApp(msg("sim", "e-3"));
    expect(out.status).toBe("salva");
    const gs = gastosInserts();
    expect(gs.length).toBe(6);
    for (const g of gs) {
      expect(g.row.categoria_id).toBe("cat-casa");
    }
    // Memória de merchant alinhada à categoria manual.
    const mems = memoryInserts();
    expect(mems.length).toBe(1);
    expect((mems[0].row as Record<string, unknown>).category_id).toBe("cat-casa");
    expect((mems[0].row as Record<string, unknown>).manual_confirmed_count).toBe(1);
  });

  it("categoria sugerida (sem ajuste) continua resolvendo por descrição", async () => {
    // Tênis → resolveCategoriaId cai em "outros" (cat-out). Sem ajuste manual.
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
    expect(out.status).toBe("salva");
    const gs = gastosInserts();
    expect(gs.length).toBe(3);
    const uniqueCats = new Set(gs.map((g) => g.row.categoria_id));
    expect(uniqueCats.size).toBe(1);
    expect([...uniqueCats][0]).toBe("cat-out");
  });

  it("memória de merchant e categoria das parcelas são SEMPRE a mesma id final", async () => {
    await processarMensagemWhatsApp(msg("Geladeira 600 em 3x no Nubank", "e-1"));
    await processarMensagemWhatsApp(msg("categoria Casa", "e-2"));
    const out = await processarMensagemWhatsApp(msg("sim", "e-3"));
    expect(out.status).toBe("salva");
    const gs = gastosInserts();
    const catIds = new Set(gs.map((g) => g.row.categoria_id));
    expect(catIds.size).toBe(1);
    const mems = memoryInserts();
    expect(mems.length).toBe(1);
    expect((mems[0].row as Record<string, unknown>).category_id).toBe([...catIds][0]);
  });

  it("readback falha se alguma parcela retornar categoria diferente da esperada", async () => {
    const originalRpc = fakeAdmin.rpc;
    // Stub: RPC simula bug — grava parcelas com categoria_id "cat-mer"
    // mesmo quando o usuário pediu Casa.

    (fakeAdmin as any).rpc = async (name: string, args?: Record<string, unknown>) => {
      if (name === "create_installment_purchase") {
        const parcelas = (args?.p_parcelas ?? []) as Array<Record<string, unknown>>;
        const userId = args?.p_user_id as string;
        const cartaoId = args?.p_cartao_id as string;
        const grupoId = args?.p_grupo_id as string;
        const total = args?.p_total_parcelas as number;
        const descricao = (args?.p_descricao ?? "") as string;
        const out: Array<Record<string, unknown>> = [];
        for (const p of parcelas) {
          const idx = state.inserts.length + 1;
          const id = `g-${idx}`;
          const row = {
            id,
            user_id: userId,
            cartao_id: cartaoId,
            categoria_id: "cat-mer", // <-- bug simulado
            descricao,
            estabelecimento: descricao,
            valor: p.valor,
            data: p.data,
            mes: p.mes,
            ano: p.ano,
            invoice_month: p.invoice_month,
            forma_pagamento: "credito",
            tipo_gasto: "parcelado",
            parcela_atual: p.numero,
            total_parcelas: total,
            grupo_parcelamento_id: grupoId,
            origem: "whatsapp",
            confirmado: true,
          };
          state.inserts.push({ table: "gastos", row });
          state.gastosData.push(row);
          out.push({ id, parcela_atual: p.numero, invoice_month: p.invoice_month, valor: p.valor });
        }
        return { data: out, error: null };
      }
      return { data: true, error: null };
    };
    try {
      await processarMensagemWhatsApp(msg("Geladeira 1200 em 6x no Nubank", "e-1"));
      await processarMensagemWhatsApp(msg("categoria Casa", "e-2"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-3"));
      expect(out.status).toBe("erro");
      expect(out.resposta.toLowerCase()).not.toContain("registrei");
    } finally {
      fakeAdmin.rpc = originalRpc;
    }
  });

  it("manualCategoriaId apontando para categoria inexistente → erro (NÃO cai em sugestão)", async () => {
    // Remove a categoria Casa do mapa do usuário entre escolha e "sim".
    await processarMensagemWhatsApp(msg("Geladeira 600 em 3x no Nubank", "e-1"));
    await processarMensagemWhatsApp(msg("categoria Casa", "e-2"));
    // Simula remoção/desativação posterior:
    state.categoriasData = state.categoriasData.filter((c) => c.id !== "cat-casa");
    const out = await processarMensagemWhatsApp(msg("sim", "e-3"));
    expect(out.status).toBe("erro");
    // Nenhuma parcela foi criada com fallback de sugestão.
    expect(gastosInserts().length).toBe(0);
  });

  it("retry/idempotência: dois 'sim' simultâneos com mesmo external_id criam UM grupo só", async () => {
    await processarMensagemWhatsApp(msg("Geladeira 1200 em 6x no Nubank", "e-1"));
    await processarMensagemWhatsApp(msg("categoria Casa", "e-2"));
    const [a, b] = await Promise.all([
      processarMensagemWhatsApp(msg("sim", "e-confirm")),
      processarMensagemWhatsApp(msg("sim", "e-confirm")),
    ]);
    const sucesso = [a, b].filter((r) => r.status === "salva");
    expect(sucesso.length).toBe(1);
    const grupos = new Set(
      gastosInserts()
        .map((g) => g.row.grupo_parcelamento_id as string)
        .filter(Boolean),
    );
    expect(grupos.size).toBe(1);
    expect(gastosInserts().length).toBe(6);
    // E todas com a categoria manual.
    for (const g of gastosInserts()) {
      expect(g.row.categoria_id).toBe("cat-casa");
    }
  });
});
