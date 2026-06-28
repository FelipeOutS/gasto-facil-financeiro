/**
 * WA-C10.a — Cadastro de CONTA A PAGAR a partir de boleto por código de
 * barras ou linha digitável (texto). Sem foto/PDF/OCR (WA-C10.b).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { state, resetState } from "./_whatsapp-fake";

const {
  tryParseBoleto,
  detectBoletoFromText,
  _buildBoletoCobrancaForTest,
  _buildBoletoArrecadForTest,
  mascararCodigo,
} = await import("../src/server/whatsapp-boleto-parser");

const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);

function msg(texto: string, externalId = `ext-${Math.random().toString(36).slice(2, 10)}`) {
  return {
    external_id: externalId,
    telefone: "5511999998888",
    texto,
    recebida_em: new Date().toISOString(),
    authorizedUserId: "u1",
  } as const;
}

beforeEach(() => resetState());
afterEach(() => resetState());

describe("WA-C10.a — parser puro", () => {
  it("aceita linha digitável de cobrança válida", () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 12000 });
    expect(linha).toHaveLength(47);
    const p = tryParseBoleto(linha);
    expect(p).not.toBeNull();
    expect(p!.tipo).toBe("cobranca");
    expect(p!.valorCentavos).toBe(12000);
    expect(p!.vencimentoISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("aceita código de barras de cobrança (44 dígitos)", () => {
    const { barcode } = _buildBoletoCobrancaForTest({ valorCentavos: 89000, fator: 9000 });
    expect(barcode).toHaveLength(44);
    const p = tryParseBoleto(barcode);
    expect(p).not.toBeNull();
    expect(p!.tipo).toBe("cobranca");
    expect(p!.valorCentavos).toBe(89000);
  });

  it("aceita arrecadação válida (48 dígitos linha)", () => {
    const { linha } = _buildBoletoArrecadForTest({});
    expect(linha).toHaveLength(48);
    const p = tryParseBoleto(linha);
    expect(p).not.toBeNull();
    expect(p!.tipo).toBe("arrecadacao");
    expect(p!.valorCentavos).toBeNull();
    expect(p!.vencimentoISO).toBeNull();
  });

  it("tolera espaços, pontos, traços e quebras de linha", () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 5000 });
    const formatado = [
      linha.slice(0, 5),
      linha.slice(5, 10),
      ".",
      linha.slice(10, 21),
      "\n",
      linha.slice(21, 32),
      "-",
      linha.slice(32, 33),
      " ",
      linha.slice(33),
    ].join(" ");
    const p = tryParseBoleto(formatado);
    expect(p).not.toBeNull();
    expect(p!.valorCentavos).toBe(5000);
  });

  it("rejeita código com dígito verificador inválido", () => {
    const { linha } = _buildBoletoCobrancaForTest({});
    const bad = linha.slice(0, 30) + (Number(linha[30]) === 9 ? "0" : "9") + linha.slice(31);
    expect(tryParseBoleto(bad)).toBeNull();
  });

  it("rejeita tamanhos diferentes de 44/47/48", () => {
    expect(tryParseBoleto("12345678901")).toBeNull(); // CPF
    expect(tryParseBoleto("12345678000190")).toBeNull(); // CNPJ
    expect(tryParseBoleto("5511999998888")).toBeNull(); // telefone
    expect(tryParseBoleto("4111111111111111")).toBeNull(); // cartão 16
    expect(tryParseBoleto("0".repeat(43))).toBeNull();
    expect(tryParseBoleto("0".repeat(46))).toBeNull();
  });

  it("rejeita Pix copia-e-cola (alfanumérico)", () => {
    const emv = "00020126580014BR.GOV.BCB.PIX0136abc";
    expect(tryParseBoleto(emv)).toBeNull();
  });

  it("rejeita string vazia / nula", () => {
    expect(tryParseBoleto("")).toBeNull();
    // @ts-expect-error testing null
    expect(tryParseBoleto(null)).toBeNull();
  });

  it("detecta boleto dentro de frase", () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 7500 });
    const p = detectBoletoFromText(`GI, adiciona esse boleto pra mim: ${linha}`);
    expect(p).not.toBeNull();
    expect(p!.valorCentavos).toBe(7500);
  });

  it("não detecta boleto em frase comum sem código", () => {
    expect(detectBoletoFromText("paguei a conta de luz")).toBeNull();
    expect(detectBoletoFromText("tenho 50 reais")).toBeNull();
    expect(detectBoletoFromText("o boleto vence amanhã")).toBeNull();
  });

  it("mascara mantém somente últimos 4 dígitos", () => {
    const { linha } = _buildBoletoCobrancaForTest({});
    expect(mascararCodigo(linha)).toBe(`****${linha.slice(-4)}`);
  });

  it("fingerprint é estável para o mesmo código", () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 1000 });
    const a = tryParseBoleto(linha)!;
    const b = tryParseBoleto(linha)!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toHaveLength(32);
  });
});

describe("WA-C10.a — fluxo de cadastro", () => {
  it("código válido com valor e vencimento → preview + confirmação → conta criada", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 12000, fator: 9999 });
    const r1 = await processarMensagemWhatsApp(msg(linha));
    expect(r1.status).toBe("pendente");
    // Pula direto para pedir identificação (valor+venc já vieram do código).
    expect(r1.resposta).toMatch(/identifica/i);

    const r2 = await processarMensagemWhatsApp(msg("Internet"));
    expect(r2.status).toBe("pendente");
    expect(r2.resposta).toMatch(/Confirma cadastrar/i);
    expect(r2.resposta).toMatch(/Internet/);
    expect(r2.resposta).not.toContain(linha); // código bruto NÃO no preview
    expect(r2.resposta).toContain("****");

    const r3 = await processarMensagemWhatsApp(msg("1"));
    expect(r3.status).toBe("salva");
    const contas = state.inserts.filter((i) => i.table === "contas_a_pagar");
    expect(contas).toHaveLength(1);
    const row = contas[0].row;
    expect(row.forma_pagamento).toBe("boleto");
    expect(row.codigo_boleto).toBeDefined();
    expect(row.status).toBe("pendente");
    expect(row.nome).toBe("Internet");
    expect(row.valor).toBe(120);
  });

  it("arrecadação válida → pergunta valor e vencimento", async () => {
    const { linha } = _buildBoletoArrecadForTest({});
    const r1 = await processarMensagemWhatsApp(msg(linha));
    expect(r1.status).toBe("pendente");
    expect(r1.resposta).toMatch(/Qual é o valor/i);

    const r2 = await processarMensagemWhatsApp(msg("R$ 240,50"));
    expect(r2.resposta).toMatch(/data de vencimento/i);

    const r3 = await processarMensagemWhatsApp(msg("15/08/2026"));
    expect(r3.resposta).toMatch(/identifica/i);

    const r4 = await processarMensagemWhatsApp(msg("Energia"));
    expect(r4.resposta).toMatch(/Confirma cadastrar/i);

    const r5 = await processarMensagemWhatsApp(msg("1"));
    expect(r5.status).toBe("salva");
    const row = state.inserts.filter((i) => i.table === "contas_a_pagar")[0].row;
    expect(row.nome).toBe("Energia");
    expect(row.valor).toBe(240.5);
    expect(row.data_vencimento).toBe("2026-08-15");
  });

  it("cancelar interrompe o fluxo em qualquer estado", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 5000 });
    await processarMensagemWhatsApp(msg(linha));
    const r = await processarMensagemWhatsApp(msg("cancelar"));
    expect(r.status).toBe("cancelada");
    expect(state.inserts.filter((i) => i.table === "contas_a_pagar")).toHaveLength(0);
  });

  it("código inválido na entrada inicial → mensagem clara e nada criado", async () => {
    // 47 dígitos mas DV ruim
    const { linha } = _buildBoletoCobrancaForTest({});
    const bad = linha.slice(0, 9) + (Number(linha[9]) === 0 ? "1" : "0") + linha.slice(10);
    const r = await processarMensagemWhatsApp(msg(bad));
    // O detector rejeita; cai no parser de gasto genérico (não vira boleto).
    // Garantimos que nenhuma conta foi criada.
    expect(state.inserts.filter((i) => i.table === "contas_a_pagar")).toHaveLength(0);
    void r;
  });

  it("corrige valor pelo menu de confirmação", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 10000 });
    await processarMensagemWhatsApp(msg(linha));
    await processarMensagemWhatsApp(msg("Aluguel"));
    const r1 = await processarMensagemWhatsApp(msg("2")); // corrigir valor
    expect(r1.resposta).toMatch(/Qual é o valor/i);
    await processarMensagemWhatsApp(msg("R$ 150,00"));
    const r3 = await processarMensagemWhatsApp(msg("1"));
    expect(r3.status).toBe("salva");
    const row = state.inserts.filter((i) => i.table === "contas_a_pagar")[0].row;
    expect(row.valor).toBe(150);
  });

  it("duplicidade: oferece menu e respeita 'continuar mesmo assim'", async () => {
    const { linha, barcode } = _buildBoletoCobrancaForTest({ valorCentavos: 30000, fator: 9000 });
    // Semeia uma conta pendente com o mesmo código.
    resetState({
      contas: [{
        id: "c-prev", user_id: "u1", nome: "Internet anterior",
        codigo_boleto: barcode, status: "pendente",
        valor: 300, data_vencimento: "2026-01-01",
      }],
    });
    const r1 = await processarMensagemWhatsApp(msg(linha));
    expect(r1.resposta).toMatch(/já está nas suas contas pendentes/i);
    expect(r1.resposta).toContain("****");

    const r2 = await processarMensagemWhatsApp(msg("2"));
    // continuar mesmo assim → pergunta identificação
    expect(r2.resposta).toMatch(/identifica/i);

    await processarMensagemWhatsApp(msg("Internet nova"));
    const r4 = await processarMensagemWhatsApp(msg("1"));
    expect(r4.status).toBe("salva");
    // Agora há 2 contas com mesmo código.
    expect(state.contasData.filter((c) => c.codigo_boleto === barcode).length).toBe(2);
  });

  it("duplicidade: 'cancelar' não cria conta nova", async () => {
    const { linha, barcode } = _buildBoletoCobrancaForTest({ valorCentavos: 9999 });
    resetState({
      contas: [{
        id: "c-prev", user_id: "u1", nome: "Já existe",
        codigo_boleto: barcode, status: "pendente",
        valor: 99.99, data_vencimento: "2026-01-01",
      }],
    });
    await processarMensagemWhatsApp(msg(linha));
    const r2 = await processarMensagemWhatsApp(msg("3"));
    expect(r2.status).toBe("cancelada");
    // Continua só a conta original semeada.
    expect(state.contasData).toHaveLength(1);
  });

  it("retry do mesmo external_id não cria conta duplicada", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 1500 });
    const ext = "ext-retry-1";
    await processarMensagemWhatsApp(msg(linha, ext));
    await processarMensagemWhatsApp(msg("Internet", `${ext}-2`));
    // confirma com NOVO external_id (claim atômico usa ele)
    const r = await processarMensagemWhatsApp(msg("1", `${ext}-confirm`));
    expect(r.status).toBe("salva");
    // Reentrega exata da confirmação (mesmo external_id) → bloqueado pelo
    // índice único, NÃO cria segunda conta.
    const r2 = await processarMensagemWhatsApp(msg("1", `${ext}-confirm`));
    expect(["sem_pendencia", "erro", "salva"]).toContain(r2.status);
    const contas = state.inserts.filter((i) => i.table === "contas_a_pagar");
    expect(contas).toHaveLength(1);
  });

  it("boleto vencido cria conta pendente com aviso", async () => {
    // Fator 5000 (~ 2011) — definitivamente passado.
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 4500, fator: 5000 });
    await processarMensagemWhatsApp(msg(linha));
    await processarMensagemWhatsApp(msg("Velha"));
    const r = await processarMensagemWhatsApp(msg("1"));
    expect(r.status).toBe("salva");
    expect(r.resposta).toMatch(/vencid/i);
    const row = state.inserts.filter((i) => i.table === "contas_a_pagar")[0].row;
    expect(row.status).toBe("pendente");
  });
});

describe("WA-C10.a — segurança / logs", () => {
  it("não loga código bruto", async () => {
    const calls: string[] = [];
    const origInfo = console.info;
    console.info = (...args: unknown[]) => {
      calls.push(JSON.stringify(args));
    };
    try {
      const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 10000 });
      await processarMensagemWhatsApp(msg(linha));
      await processarMensagemWhatsApp(msg("Internet"));
      await processarMensagemWhatsApp(msg("1"));
      const joined = calls.join("\n");
      expect(joined).not.toContain(linha);
      expect(joined).toMatch(/wa_boleto_decision/);
      expect(joined).toMatch(/fingerprint/);
    } finally {
      console.info = origInfo;
    }
  });

  it("sessão final não persiste código bruto", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 5000 });
    await processarMensagemWhatsApp(msg(linha));
    await processarMensagemWhatsApp(msg("Luz"));
    await processarMensagemWhatsApp(msg("1"));
    const finalMsgs = state.inserts.filter(
      (i) => i.table === "whatsapp_messages" && (i.row as { status?: string }).status === "salva",
    );
    for (const m of finalMsgs) {
      const parsed = JSON.stringify((m.row as { parsed?: unknown }).parsed ?? {});
      // só guarda fingerprint/mascara/identificacao/valor/venc — nada de codigo bruto
      expect(parsed).not.toContain(linha);
    }
  });
});

describe("WA-C10.a — não colisão com outros domínios", () => {
  it("CPF/CNPJ/telefone não disparam fluxo de boleto", async () => {
    resetState();
    await processarMensagemWhatsApp(msg("meu cpf é 123.456.789-09"));
    await processarMensagemWhatsApp(msg("cnpj 12.345.678/0001-90"));
    await processarMensagemWhatsApp(msg("liga pro 11 99999-8888"));
    expect(state.inserts.filter((i) => i.table === "contas_a_pagar")).toHaveLength(0);
  });

  it("frases de gasto comum não disparam boleto", async () => {
    resetState();
    const r = await processarMensagemWhatsApp(msg("gastei 50 no mercado"));
    expect(state.inserts.filter((i) => i.table === "contas_a_pagar")).toHaveLength(0);
    void r;
  });
});
