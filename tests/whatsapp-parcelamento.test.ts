/**
 * WA-F3 — Testes da compra PARCELADA no cartão via WhatsApp.
 *
 * Cobertura:
 * - cálculo financeiro (centavos, soma exata);
 * - detecção robusta de parcelamento (e bloqueio de falsos positivos);
 * - prévia, ajuste, cancelamento, persistência;
 * - integração com fluxo principal sem interromper sessões ativas.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import "./_whatsapp-fake";
import { resetState, state, gastosInserts, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

// IMPORTANTE: imports dinâmicos top-level garantem que o `mock.module(...)`
// registrado em `_whatsapp-fake` esteja ativo antes dos módulos de
// produção capturarem o cliente Supabase. Este é o mesmo padrão usado em
// todos os outros testes do WhatsApp que precisam do supabaseAdmin
// mockado (ver whatsapp-faturas-detalhe.test.ts, whatsapp-beta.test.ts,
// whatsapp-hardening-b3.test.ts etc).
const { calcularParcelasCentavos, criarPlanoParcelamento, reaisParaCentavos } =
  await import("../src/server/cartao-parcelamento.server");
const { detectInstallmentIntent, extrairValor, extrairQuantidadeParcelas } =
  await import("../src/server/whatsapp-parcelamento.server");
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

describe("WA-F3 — financial helper", () => {
  it("100 em 3x distribui centavos: [33.34, 33.33, 33.33]", () => {
    const parts = calcularParcelasCentavos(10000, 3);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
  });
  it("89,90 em 2x", () => {
    const parts = calcularParcelasCentavos(reaisParaCentavos(89.9), 2);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(8990);
    expect(parts).toEqual([4495, 4495]);
  });
  it("1.200 em 12x divisão exata", () => {
    const parts = calcularParcelasCentavos(120000, 12);
    expect(parts.every((p) => p === 10000)).toBe(true);
  });
  it("rejeita parcelas <2 ou >48", () => {
    expect(() => calcularParcelasCentavos(10000, 1)).toThrow();
    expect(() => calcularParcelasCentavos(10000, 49)).toThrow();
  });
  it("rejeita total inválido", () => {
    expect(() => calcularParcelasCentavos(0, 3)).toThrow();
  });
  it("criarPlanoParcelamento monta meses sequenciais e soma exata", () => {
    const plano = criarPlanoParcelamento({
      totalReais: 100,
      totalParcelas: 3,
      diaFechamentoCartao: 28,
      dataCompra: new Date(2024, 5, 10), // 10/jun/2024
    });
    expect(plano.totalParcelas).toBe(3);
    expect(plano.parcelas.length).toBe(3);
    expect(plano.parcelas[0].valor + plano.parcelas[1].valor + plano.parcelas[2].valor).toBeCloseTo(
      100,
      2,
    );
    // YYYY-MM consecutivos
    expect(plano.parcelas[1].invoiceMonth).not.toBe(plano.parcelas[0].invoiceMonth);
    expect(plano.parcelas[2].invoiceMonth).not.toBe(plano.parcelas[1].invoiceMonth);
  });
});

describe("WA-F3 — detection", () => {
  it("aceita 'em 3 vezes'", () => {
    expect(detectInstallmentIntent("Comprei um tênis de 300 reais em 3 vezes no Nubank.")).toEqual({
      count: 3,
    });
  });
  it("aceita 'em 12 parcelas'", () => {
    expect(detectInstallmentIntent("Paguei 1.200 em 12 parcelas no cartão Inter")).toEqual({
      count: 12,
    });
  });
  it("aceita 'em 2x no crédito'", () => {
    expect(detectInstallmentIntent("Foi 89,90 em 2x no crédito.")).toEqual({ count: 2 });
  });
  it("aceita 'parcelada em 10 vezes'", () => {
    expect(
      detectInstallmentIntent("Comprei uma televisão de 2 mil reais parcelada em 10 vezes"),
    ).toEqual({ count: 10 });
  });
  it("não confunde 'três vezes essa semana'", () => {
    expect(detectInstallmentIntent("paguei três vezes essa semana")).toBeNull();
  });
  it("não confunde 'tenho três cartões'", () => {
    expect(detectInstallmentIntent("tenho três cartões")).toBeNull();
  });
  it("não confunde 'comprei três produtos'", () => {
    expect(detectInstallmentIntent("comprei três produtos")).toBeNull();
  });
  it("não confunde 'dia três vence a conta'", () => {
    expect(detectInstallmentIntent("dia três vence a conta")).toBeNull();
  });
  it("não confunde 'quero dividir minhas despesas'", () => {
    expect(detectInstallmentIntent("quero dividir minhas despesas")).toBeNull();
  });
});

describe("WA-F3 — parsers auxiliares", () => {
  it("extrairValor entende '2 mil reais'", () => {
    expect(extrairValor("uma TV de 2 mil reais parcelada em 10 vezes")).toBe(2000);
  });
  it("extrairValor entende '1.200'", () => {
    expect(extrairValor("Paguei 1.200 em 12 parcelas")).toBe(1200);
  });
  it("extrairValor entende '89,90'", () => {
    expect(extrairValor("Foi 89,90 em 2x")).toBe(89.9);
  });
  it("extrairQuantidadeParcelas digit", () => {
    expect(extrairQuantidadeParcelas("4 vezes")).toBe(4);
  });
  it("extrairQuantidadeParcelas extenso", () => {
    expect(extrairQuantidadeParcelas("quatro")).toBe(4);
  });
});

describe("WA-F3 — fluxo conversacional", () => {
  beforeEach(() => {
    resetState({
      cartoes: [
        {
          id: "c-nu",
          nome: "Nubank",
          banco: "Nubank",
          limite_total: 0,
          dia_fechamento: 28,
          dia_vencimento: 10,
          cor: "#000",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "c-int",
          nome: "Inter",
          banco: "Inter",
          limite_total: 0,
          dia_fechamento: 1,
          dia_vencimento: 10,
          cor: "#000",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
  });

  it("mensagem completa gera prévia sem persistir gastos", async () => {
    const out = await processarMensagemWhatsApp(
      msg("Comprei um tênis de 300 reais em 3 vezes no Nubank."),
    );
    expect(out.status).toBe("aguardando_confirmacao");
    expect(out.resposta).toContain("3x");
    expect(out.resposta).toContain("Nubank");
    expect(gastosInserts().length).toBe(0);
  });

  it("sem cartão e múltiplos cartões → pergunta cartão", async () => {
    const out = await processarMensagemWhatsApp(msg("Comprei algo de 100 em 4 vezes no crédito"));
    expect(out.status).toBe("pendente");
    expect(out.resposta.toLowerCase()).toContain("cart");
  });

  it("um único cartão é selecionado automaticamente", async () => {
    resetState({
      cartoes: [
        {
          id: "c-nu",
          nome: "Nubank",
          banco: "Nubank",
          limite_total: 0,
          dia_fechamento: 1,
          dia_vencimento: 10,
          cor: "#000",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
    const out = await processarMensagemWhatsApp(msg("Algo de 100 em 2x no crédito"));
    expect(out.status).toBe("aguardando_confirmacao");
    expect(out.resposta).toContain("Nubank");
  });

  it("confirmação cria N gastos com grupo_parcelamento_id comum", async () => {
    await processarMensagemWhatsApp(
      msg("Comprei um tênis de 300 reais em 3 vezes no Nubank.", "e-1"),
    );
    expect(gastosInserts().length).toBe(0);
    const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
    expect(out.status).toBe("salva");
    const gs = gastosInserts();
    expect(gs.length).toBe(3);
    // soma exata
    const soma = gs.reduce((acc, g) => acc + Number(g.row.valor), 0);
    expect(Math.round(soma * 100)).toBe(30000);
    // mesmo grupo
    const grupos = new Set(gs.map((g) => g.row.grupo_parcelamento_id));
    expect(grupos.size).toBe(1);
    // parcela_atual sequenciais
    expect(gs.map((g) => g.row.parcela_atual).sort()).toEqual([1, 2, 3]);
    // todos no Nubank
    expect(gs.every((g) => g.row.cartao_id === "c-nu")).toBe(true);
  });

  it("cancelar não cria parcelas", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const out = await processarMensagemWhatsApp(msg("cancelar", "e-2"));
    expect(out.status).toBe("cancelada");
    expect(gastosInserts().length).toBe(0);
  });

  it("ajuste de valor antes do sim recalcula prévia", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const out = await processarMensagemWhatsApp(msg("o valor certo é 360", "e-2"));
    expect(out.status).toBe("aguardando_confirmacao");
    // BRL usa NBSP entre "R$" e o número (formato pt-BR).
    expect(out.resposta).toContain(`R$\u00a0120`);
  });

  it("falta valor → pergunta valor", async () => {
    const out = await processarMensagemWhatsApp(msg("Comprei um tênis em 3 vezes no Nubank"));
    expect(out.status).toBe("pendente");
    expect(out.resposta.toLowerCase()).toContain("valor total");
  });

  it("mensagem reenviada (mesmo external_id após salva) não duplica", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const ok = await processarMensagemWhatsApp(msg("sim", "e-2"));
    expect(ok.status).toBe("salva");
    const before = gastosInserts().length;
    const dup = await processarMensagemWhatsApp(msg("sim", "e-2"));
    expect(dup.status).toBe("duplicada");
    expect(gastosInserts().length).toBe(before);
  });

  it("frase ambígua não vira parcelamento", async () => {
    const out = await processarMensagemWhatsApp(msg("paguei três vezes essa semana"));
    expect(out.status).not.toBe("aguardando_confirmacao");
    expect(gastosInserts().length).toBe(0);
  });
});

describe("WA-F3.2 — persistência atômica via RPC", () => {
  let fake: typeof import("./_whatsapp-fake").fakeAdmin;
  beforeEach(async () => {
    fake = (await import("./_whatsapp-fake")).fakeAdmin;
    resetState({
      cartoes: [
        {
          id: "c-nu",
          nome: "Nubank",
          banco: "Nubank",
          limite_total: 0,
          dia_fechamento: 28,
          dia_vencimento: 10,
          cor: "#000",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
  });

  it("R$ 1.200,50 em 3x: soma exata e parcelas seguem invoice_month sequencial", async () => {
    await processarMensagemWhatsApp(msg("Comprei algo de R$ 1.200,50 em 3x no Nubank", "e-1"));
    const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
    expect(out.status).toBe("salva");
    const gs = gastosInserts();
    expect(gs.length).toBe(3);
    const soma = gs.reduce((acc, g) => acc + Number(g.row.valor), 0);
    expect(Math.round(soma * 100)).toBe(120050);
    // invoice_month sequencial mês a mês (3 valores distintos).
    const ims = gs.map((g) => g.row.invoice_month as string);
    expect(new Set(ims).size).toBe(3);
    // Centavos extras vão para a primeira parcela.
    const valores = gs
      .sort((a, b) => (a.row.parcela_atual as number) - (b.row.parcela_atual as number))
      .map((g) => Math.round(Number(g.row.valor) * 100));
    expect(valores[0]).toBeGreaterThanOrEqual(valores[1]);
    expect(valores[0] + valores[1] + valores[2]).toBe(120050);
  });

  it("falha na transação não cria parcela parcial", async () => {
    const original = fake.rpc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fake as any).rpc = async (name: string) => {
      if (name === "create_installment_purchase") {
        return { data: null, error: { message: "boom" } };
      }
      return { data: true, error: null };
    };
    try {
      await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
      expect(out.status).toBe("erro");
      expect(gastosInserts().length).toBe(0);
      expect(out.resposta.toLowerCase()).not.toContain("registrei");
    } finally {
      fake.rpc = original;
    }
  });

  it("falha no readback não envia sucesso falso", async () => {
    const original = fake.rpc;
    // RPC retorna ok, mas não persiste nada → readback encontra 0 linhas.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fake as any).rpc = async (name: string, args?: Record<string, unknown>) => {
      if (name === "create_installment_purchase") {
        // Devolve só metadados sem gravar em state.gastosData.
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
    };
    try {
      await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
      expect(out.status).toBe("erro");
      expect(out.resposta.toLowerCase()).not.toContain("registrei");
      expect(gastosInserts().filter((g) => g.row.grupo_parcelamento_id).length).toBe(0);
    } finally {
      fake.rpc = original;
    }
  });

  it("mensagem de sucesso não lista parcelas individualmente", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    const out = await processarMensagemWhatsApp(msg("sim", "e-2"));
    expect(out.status).toBe("salva");
    expect(out.resposta).toContain("Registrei sua compra parcelada");
    // Não enumera "1/3", "2/3", "3/3" no corpo de sucesso.
    expect(out.resposta).not.toMatch(/1\/3/);
    expect(out.resposta).not.toMatch(/2\/3/);
  });

  it("todas as parcelas compartilham o mesmo grupo_parcelamento_id (uuid)", async () => {
    await processarMensagemWhatsApp(msg("Tênis 300 em 3x no Nubank", "e-1"));
    await processarMensagemWhatsApp(msg("sim", "e-2"));
    const grupos = gastosInserts().map((g) => g.row.grupo_parcelamento_id);
    expect(new Set(grupos).size).toBe(1);
    expect(typeof grupos[0]).toBe("string");
    // UUID v4 simplificado.
    expect(String(grupos[0])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
