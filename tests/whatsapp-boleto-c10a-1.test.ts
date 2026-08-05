/**
 * WA-C10.a.1 — Hardening do cadastro de boleto por texto:
 *  - extração de valor: prova de que o offset oficial (slice 9..18) é
 *    o usado e que o campo livre nunca contamina;
 *  - fingerprint pepper por ambiente (sem fallback inseguro em produção);
 *  - menu/ajuda preservam sessão ativa;
 *  - cancelamento limpa código bruto da sessão final;
 *  - concorrência paralela com mesmo external_id cria apenas 1 conta.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { state, resetState, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { tryParseBoleto, _buildBoletoCobrancaForTest } =
  await import("../src/server/whatsapp-boleto-parser");

const {
  __setBoletoPepperForTest,
  __resetBoletoPepperCacheForTest,
  getBoletoFingerprintPepper,
  BoletoSecretMissingError,
} = await import("../src/server/whatsapp-boleto-secret.server");

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

beforeEach(() => {
  resetState();
  __setBoletoPepperForTest("test-pepper-c10a1");
});
afterEach(() => {
  resetState();
  __setBoletoPepperForTest(null);
  __resetBoletoPepperCacheForTest();
});

// ---------- Parte 1: extração de valor ----------

describe("WA-C10.a.1 — extração de valor (offset oficial)", () => {
  it("usa o campo de valor (posições 9..18), nunca os últimos 10 dígitos", () => {
    // Campo livre adversarial: termina em "0000099999" — se o parser
    // (incorretamente) usasse os últimos 10 dígitos do barcode, leria
    // 99.999 centavos. O valor REAL é 12000 centavos (R$ 120,00).
    const livre = "1234567890123450000099999"; // 25 dígitos, sufixo "perigoso"
    const { barcode, linha } = _buildBoletoCobrancaForTest({
      valorCentavos: 12000,
      fator: 9999,
      livre,
    });
    expect(barcode).toHaveLength(44);
    expect(barcode.slice(-10)).toBe("0000099999"); // garante o adversarial
    const fromBar = tryParseBoleto(barcode);
    const fromLinha = tryParseBoleto(linha);
    expect(fromBar?.valorCentavos).toBe(12000);
    expect(fromLinha?.valorCentavos).toBe(12000);
  });

  it("linha 47 e código 44 produzem o mesmo valor, vencimento e fingerprint", () => {
    const { barcode, linha } = _buildBoletoCobrancaForTest({
      valorCentavos: 8745,
      fator: 9000,
    });
    const a = tryParseBoleto(barcode)!;
    const b = tryParseBoleto(linha)!;
    expect(a.valorCentavos).toBe(b.valorCentavos);
    expect(a.vencimentoISO).toBe(b.vencimentoISO);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.codigoBarras).toBe(b.codigoBarras);
  });

  it("valor zero permanece null (handler pergunta ao usuário)", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 0 });
    const p = tryParseBoleto(linha)!;
    expect(p.valorCentavos).toBeNull();
    const r = await processarMensagemWhatsApp(msg(linha));
    expect(r.status).toBe("pendente");
    expect(r.resposta).toMatch(/Qual é o valor/i);
  });

  it("DV inválido → tryParseBoleto retorna null", () => {
    const { barcode } = _buildBoletoCobrancaForTest({ valorCentavos: 5000 });
    // Flipa o DV global (posição 4).
    const flipped = barcode.slice(0, 4) + (Number(barcode[4]) === 0 ? "1" : "0") + barcode.slice(5);
    expect(tryParseBoleto(flipped)).toBeNull();
  });

  it("boleto vencido mantém o valor extraído", () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 4500, fator: 5000 });
    const p = tryParseBoleto(linha)!;
    expect(p.valorCentavos).toBe(4500);
    expect(p.vencimentoISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------- Parte 2: fingerprint pepper por ambiente ----------

describe("WA-C10.a.1 — fingerprint pepper por ambiente", () => {
  it("usa o override de teste quando presente", () => {
    __setBoletoPepperForTest("pepper-override-A");
    expect(getBoletoFingerprintPepper()).toBe("pepper-override-A");
  });

  it("produção sem secret → lança BoletoSecretMissingError", () => {
    const origNode = process.env.NODE_ENV;
    const origSecret = process.env.WHATSAPP_BOLETO_FINGERPRINT_SECRET;
    __setBoletoPepperForTest(null);
    delete process.env.WHATSAPP_BOLETO_FINGERPRINT_SECRET;
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
    const origErr = console.error;
    console.error = () => {};
    try {
      expect(() => getBoletoFingerprintPepper()).toThrow(BoletoSecretMissingError);
    } finally {
      console.error = origErr;
      if (origNode === undefined) delete process.env.NODE_ENV;
      else Object.defineProperty(process.env, "NODE_ENV", { value: origNode, configurable: true });
      if (origSecret !== undefined) process.env.WHATSAPP_BOLETO_FINGERPRINT_SECRET = origSecret;
      __resetBoletoPepperCacheForTest();
    }
  });

  it("dev sem secret → usa fallback dev-only e emite warn", () => {
    const origNode = process.env.NODE_ENV;
    const origSecret = process.env.WHATSAPP_BOLETO_FINGERPRINT_SECRET;
    __setBoletoPepperForTest(null);
    delete process.env.WHATSAPP_BOLETO_FINGERPRINT_SECRET;
    Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true });
    const warns: unknown[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warns.push(args);
    try {
      const v = getBoletoFingerprintPepper();
      expect(v).toBe("dev-only-wa-c10a-fp");
      expect(JSON.stringify(warns)).toMatch(/wa_boleto_secret_dev_fallback/);
    } finally {
      console.warn = origWarn;
      if (origNode === undefined) delete process.env.NODE_ENV;
      else Object.defineProperty(process.env, "NODE_ENV", { value: origNode, configurable: true });
      if (origSecret !== undefined) process.env.WHATSAPP_BOLETO_FINGERPRINT_SECRET = origSecret;
      __resetBoletoPepperCacheForTest();
    }
  });
});

// ---------- Parte 3: menu/ajuda preservam sessão ----------

describe("WA-C10.a.1 — menu/ajuda em sessão ativa", () => {
  it("ajuda em bol_aguardando_identificacao preserva valor e venc", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 7700, fator: 9999 });
    const r1 = await processarMensagemWhatsApp(msg(linha));
    expect(r1.resposta).toMatch(/identifica/i);

    const rHelp = await processarMensagemWhatsApp(msg("ajuda"));
    expect(rHelp.status).toBe("pendente");
    expect(rHelp.resposta).toMatch(/cadastrando um boleto/i);
    expect(rHelp.resposta).toMatch(/cancelar/i);

    // Continua o fluxo normalmente.
    await processarMensagemWhatsApp(msg("Internet"));
    const rFinal = await processarMensagemWhatsApp(msg("1"));
    expect(rFinal.status).toBe("salva");
    const row = state.inserts.filter((i) => i.table === "contas_a_pagar")[0].row;
    expect(row.valor).toBe(77);
    expect(row.nome).toBe("Internet");
  });

  it("menu em bol_aguardando_confirmacao oferece bifurcação e não perde sessão", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 3300 });
    await processarMensagemWhatsApp(msg(linha));
    await processarMensagemWhatsApp(msg("Luz"));
    const rMenu = await processarMensagemWhatsApp(msg("menu"));
    expect(rMenu.status).toBe("pendente");
    expect(rMenu.resposta).toMatch(/boleto em andamento/i);
    expect(rMenu.resposta).toMatch(/cancelar/i);

    // Usuário decide confirmar; sessão preservada.
    const rOk = await processarMensagemWhatsApp(msg("1"));
    expect(rOk.status).toBe("salva");
  });

  it('cancelar ("5" no menu de confirmação) limpa código bruto da sessão final', async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 2200 });
    await processarMensagemWhatsApp(msg(linha));
    await processarMensagemWhatsApp(msg("Internet"));
    const r = await processarMensagemWhatsApp(msg("5"));
    expect(r.status).toBe("cancelada");
    const finalBoletoMsgs = state.inserts.filter((i) => {
      if (i.table !== "whatsapp_messages") return false;
      const row = i.row as { status?: string; parsed?: { kind?: string } };
      return row.status === "cancelada" && row.parsed?.kind === "boleto";
    });
    expect(finalBoletoMsgs.length).toBeGreaterThan(0);
    // A sessão final emitida pelo handler de cancelamento deve estar
    // sanitizada (codigoBarras = ""). Pode haver outras linhas cancelada
    // anteriores (rebobinadas/expiradas) — basta haver UMA sanitizada.
    const sanitizadas = finalBoletoMsgs.filter(
      (m) => (m.row as { parsed?: { codigoBarras?: string } }).parsed?.codigoBarras === "",
    );
    expect(sanitizadas.length).toBeGreaterThan(0);
  });
});

// ---------- Parte 4: concorrência real ----------

describe("WA-C10.a.1 — concorrência paralela", () => {
  it("duas confirmações simultâneas com mesmo external_id criam só 1 conta", async () => {
    const { linha } = _buildBoletoCobrancaForTest({ valorCentavos: 6000, fator: 9999 });
    await processarMensagemWhatsApp(msg(linha));
    await processarMensagemWhatsApp(msg("Internet"));

    const calls: string[] = [];
    const origInfo = console.info;
    console.info = (...args: unknown[]) => calls.push(JSON.stringify(args));
    try {
      const ext = "ext-paralelo-1";
      const [a, b] = await Promise.all([
        processarMensagemWhatsApp(msg("1", ext)),
        processarMensagemWhatsApp(msg("1", ext)),
      ]);
      const contas = state.inserts.filter((i) => i.table === "contas_a_pagar");
      expect(contas).toHaveLength(1);
      const ok = [a, b].filter((r) => r.status === "salva");
      expect(ok.length).toBe(1);
      // A outra deve ter resposta neutra/idempotente, sem sucesso falso.
      const other = [a, b].find((r) => r.status !== "salva")!;
      expect(["erro", "sem_pendencia", "pendente"]).toContain(other.status);
      // Nenhum log com a linha bruta.
      expect(calls.join("\n")).not.toContain(linha);
    } finally {
      console.info = origInfo;
    }
  });
});
