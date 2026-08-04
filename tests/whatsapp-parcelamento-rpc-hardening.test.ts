/**
 * WA-F3.4 — Hardening da RPC `create_installment_purchase`
 *  e do ciclo de vida da sessão de claim (`parc_persistindo`).
 *
 * Cobertura:
 * - 6 parcelas: soma exata, mesmo grupo_parcelamento_id, mesmo cartão,
 *   mesma categoria, parcela_atual contígua 1..6 e tipada como integer;
 * - retorno da RPC honra `parcela_atual` como integer (não smallint);
 * - rollback completo quando a RPC falha (zero parcelas persistidas);
 * - rollback completo quando o readback falha (nenhum sucesso falso);
 * - sessão de claim `parc_persistindo` NUNCA fica órfã: em qualquer
 *   falha (RPC ou readback) a sessão é finalizada (status `erro`);
 * - retry com novo external_id é idempotente — não duplica parcelas.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import "./_whatsapp-fake";
import { resetState, state, gastosInserts, fakeAdmin } from "./_whatsapp-fake";

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

function semearCartao() {
  resetState({
    cartoes: [
      {
        id: "c-mp",
        nome: "Mercado Pago",
        banco: "Mercado Pago",
        limite_total: 0,
        dia_fechamento: 28,
        dia_vencimento: 10,
        cor: "#000",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
}

describe("WA-F3.4 — RPC create_installment_purchase: caso real (6x)", () => {
  beforeEach(() => semearCartao());

  it("Geladeira 1200 em 6x no Mercado Pago: 6 linhas, soma=1200, grupo único, parcela_atual integer 1..6", async () => {
    await processarMensagemWhatsApp(msg("Geladeira 1200 em 6x no Mercado pago", "e-prev"));
    const out = await processarMensagemWhatsApp(msg("sim", "e-sim"));
    expect(out.status).toBe("salva");
    const gs = gastosInserts();
    expect(gs.length).toBe(6);
    const soma = gs.reduce((a, g) => a + Number(g.row.valor), 0);
    expect(Math.round(soma * 100)).toBe(120000);
    const grupos = new Set(gs.map((g) => g.row.grupo_parcelamento_id));
    expect(grupos.size).toBe(1);
    expect(gs.every((g) => g.row.cartao_id === "c-mp")).toBe(true);
    const cats = new Set(gs.map((g) => g.row.categoria_id));
    expect(cats.size).toBe(1);
    const parcs = gs.map((g) => g.row.parcela_atual).sort((a, b) => (a as number) - (b as number));
    expect(parcs).toEqual([1, 2, 3, 4, 5, 6]);
    // tipo integer (nunca string/float)
    for (const p of parcs) {
      expect(Number.isInteger(p)).toBe(true);
      expect(typeof p).toBe("number");
    }
    // invoice_month sequencial (6 distintos)
    const ims = new Set(gs.map((g) => g.row.invoice_month));
    expect(ims.size).toBe(6);
  });
});

describe("WA-F3.4 — Rollback e limpeza da sessão de claim", () => {
  beforeEach(() => semearCartao());

  it("RPC falha: 0 parcelas, sessão de claim finalizada (não fica em parc_persistindo)", async () => {
    const original = fakeAdmin.rpc;
    fakeAdmin.rpc = (async (name: string) => {
      if (name === "create_installment_purchase") {
        return { data: null, error: { message: "42702 ambiguous", code: "42702" } };
      }
      return { data: true, error: null };
    }) as typeof fakeAdmin.rpc;
    try {
      await processarMensagemWhatsApp(msg("Geladeira 1200 em 6x no Mercado pago", "e-prev"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-sim"));
      expect(out.status).toBe("erro");
      expect(out.resposta.toLowerCase()).not.toContain("registrei");
      // nenhuma parcela persistida (atomicidade da RPC)
      expect(gastosInserts().length).toBe(0);
      // sessão de claim NÃO pode estar em parc_persistindo
      const claim = state.inserts.find(
        (i) => i.table === "whatsapp_messages" && i.row.external_id === "e-sim",
      );
      expect(claim).toBeTruthy();
      expect(claim!.row.status).not.toBe("parc_persistindo");
      expect(claim!.row.status).toBe("erro");
    } finally {
      fakeAdmin.rpc = original;
    }
  });

  it("Readback falha (RPC ok sem persistir): 0 parcelas e claim finalizado", async () => {
    const original = fakeAdmin.rpc;
    // RPC retorna sucesso mas nada vai para gastosData → readback encontra 0.
    fakeAdmin.rpc = (async (name: string, args?: Record<string, unknown>) => {
      if (name === "create_installment_purchase") {
        const parcelas = (args?.p_parcelas ?? []) as Array<Record<string, unknown>>;
        return {
          data: parcelas.map((p, i) => ({
            id: `phantom-${i}`,
            parcela_atual: p.numero,
            invoice_month: p.invoice_month,
            valor: p.valor,
          })),
          error: null,
        };
      }
      return { data: true, error: null };
    }) as typeof fakeAdmin.rpc;
    try {
      await processarMensagemWhatsApp(msg("Geladeira 1200 em 6x no Mercado pago", "e-prev"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-sim"));
      expect(out.status).toBe("erro");
      expect(out.resposta.toLowerCase()).not.toContain("registrei");
      expect(gastosInserts().filter((g) => g.row.grupo_parcelamento_id).length).toBe(0);
      const claim = state.inserts.find(
        (i) => i.table === "whatsapp_messages" && i.row.external_id === "e-sim",
      );
      expect(claim!.row.status).toBe("erro");
    } finally {
      fakeAdmin.rpc = original;
    }
  });

  it("Retry após falha de RPC: novo external_id confirma sem duplicar parcelas", async () => {
    const original = fakeAdmin.rpc;
    let fail = true;
    fakeAdmin.rpc = (async (name: string, args?: Record<string, unknown>) => {
      if (name === "create_installment_purchase") {
        if (fail) return { data: null, error: { message: "boom" } };
        return original(name, args);
      }
      return { data: true, error: null };
    }) as typeof fakeAdmin.rpc;
    try {
      await processarMensagemWhatsApp(msg("Geladeira 1200 em 6x no Mercado pago", "e-prev"));
      const bad = await processarMensagemWhatsApp(msg("sim", "e-sim-1"));
      expect(bad.status).toBe("erro");
      expect(gastosInserts().length).toBe(0);
      // Retry com novo external_id (cliente reenvia "sim").
      fail = false;
      const ok = await processarMensagemWhatsApp(msg("sim", "e-sim-2"));
      expect(ok.status).toBe("salva");
      const gs = gastosInserts();
      // Exatamente 6 parcelas — nada duplicado pelo retry.
      expect(gs.length).toBe(6);
      const grupos = new Set(gs.map((g) => g.row.grupo_parcelamento_id));
      expect(grupos.size).toBe(1);
    } finally {
      fakeAdmin.rpc = original;
    }
  });
});
