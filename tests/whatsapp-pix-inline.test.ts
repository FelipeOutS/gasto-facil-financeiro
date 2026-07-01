/**
 * WA-Q-PixInline — Fluxo natural "Pix VALOR para NOME chave CHAVE".
 *
 * Cobre:
 *  - Parser puro: detect + parse + máscara para os 5 tipos de chave.
 *  - Fluxo E2E: prévia sem persistência, sim cria favorecido + gasto,
 *    não/cancelar não criam nada, reuso silencioso por chave, desambiguação
 *    por nome com chave diferente, idempotência por external_id,
 *    isolamento por user_id, chave nunca em texto plano na resposta.
 *  - Regressão: parsers vizinhos (save/query/pagar_pessoa/gasto) continuam.
 */
import "./_whatsapp-fake";
import { describe, it, expect, beforeEach } from "bun:test";
import { resetState, state } from "./_whatsapp-fake";

const {
  detectPagarPixInlineIntent,
  parsePagarPixInline,
  maskPixKey,
  detectPixKeyType,
  detectSavePixIntent,
  detectQueryPixIntent,
  detectPagarPessoaIntent,
} = await import("../src/server/whatsapp-pix-parser");
const { processarMensagemWhatsApp } = await import(
  "../src/server/whatsapp.server"
);
const { _resetShortContext } = await import(
  "../src/server/whatsapp-short-context.server"
);

const telefone = "55(11) 99999-8888";

function gastoInserts() {
  return state.inserts.filter((i) => i.table === "gastos");
}
function fornecedorInserts() {
  return state.inserts.filter((i) => i.table === "fornecedores");
}

beforeEach(() => {
  resetState({});
  _resetShortContext();
});

// ==========================================================================
// 1. Parser puro
// ==========================================================================

describe("parser :: detectPagarPixInlineIntent", () => {
  it("aceita formato canônico com 'chave' + celular", () => {
    expect(
      detectPagarPixInlineIntent("Pix 50 para João Silva chave (11) 99999-8888"),
    ).toBe(true);
  });
  it("aceita 'pra' e 'pro' como preposição", () => {
    expect(
      detectPagarPixInlineIntent("pix 30 pra Maria chave maria@ex.com"),
    ).toBe(true);
    expect(
      detectPagarPixInlineIntent("Pix 100 pro Pedro chave 12345678901"),
    ).toBe(true);
  });
  it("aceita R$ e vírgula decimal", () => {
    expect(
      detectPagarPixInlineIntent(
        "Pix R$ 50,90 para Ana Costa chave 11988887777",
      ),
    ).toBe(true);
  });
  it("aceita CPF, CNPJ, e-mail e UUID (aleatória)", () => {
    expect(detectPagarPixInlineIntent("Pix 10 para X chave 12345678901")).toBe(true);
    expect(detectPagarPixInlineIntent("Pix 10 para X chave 12345678000199")).toBe(true);
    expect(detectPagarPixInlineIntent("Pix 10 para X chave a@b.co")).toBe(true);
    expect(
      detectPagarPixInlineIntent(
        "Pix 10 para X chave 550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toBe(true);
  });
  it("rejeita quando chave é lixo (desconhecida)", () => {
    expect(detectPagarPixInlineIntent("Pix 50 para João chave abc")).toBe(false);
  });
  it("não confunde com 'salva o pix do João'", () => {
    expect(detectPagarPixInlineIntent("salva o pix do João: (11) 99999-8888")).toBe(false);
    expect(detectSavePixIntent("salva o pix do João: (11) 99999-8888")).toBe(true);
  });
  it("não confunde com 'qual o pix do João?'", () => {
    expect(detectPagarPixInlineIntent("qual o pix do João?")).toBe(false);
    expect(detectQueryPixIntent("qual o pix do João?")).toBe(true);
  });
  it("não dispara em 'paguei 50 pro João no pix' (sem chave)", () => {
    expect(detectPagarPixInlineIntent("paguei 50 pro João no pix")).toBe(false);
    expect(detectPagarPessoaIntent("paguei 50 pro João no pix")).toBe(true);
  });
  it("não dispara em gasto comum que contém a palavra pix", () => {
    // Não começa com "pix" — cai no parser de gasto.
    expect(detectPagarPixInlineIntent("Uber 48,90 pix")).toBe(false);
  });
});

describe("parser :: parsePagarPixInline", () => {
  it("extrai valor+nome+chave (celular)", () => {
    const p = parsePagarPixInline("Pix 50 para João Silva chave (11) 99999-8888");
    expect(p).toBeTruthy();
    expect(p!.valorCentavos).toBe(5000);
    expect(p!.nome).toBe("João Silva");
    expect(p!.pixKeyType).toBe("telefone");
    expect(p!.pixKey).toBe("11999998888");
  });
  it("retorna null quando chave é inválida", () => {
    expect(parsePagarPixInline("Pix 50 para João chave zzz")).toBeNull();
  });
  it("não deixa a palavra 'chave' entrar no nome", () => {
    const p = parsePagarPixInline("Pix 50 para João Silva chave (11) 99999-8888");
    expect(p!.nome.toLowerCase()).not.toContain("chave");
  });
  it("formato sem 'chave' (só email)", () => {
    const p = parsePagarPixInline("Pix 25 para Ana ana@ex.com");
    expect(p).toBeTruthy();
    expect(p!.pixKeyType).toBe("email");
    expect(p!.pixKey).toBe("ana@ex.com");
  });
});

describe("parser :: maskPixKey", () => {
  it("mascara e-mail preservando domínio", () => {
    expect(maskPixKey("joao@example.com", "email")).toMatch(/^j\*+.*@example\.com$/);
  });
  it("mascara celular preservando últimos 4", () => {
    expect(maskPixKey("11999998888", "telefone")).toContain("8888");
    expect(maskPixKey("11999998888", "telefone")).not.toContain("99999");
  });
  it("mascara CPF totalmente (nunca vaza final)", () => {
    expect(maskPixKey("12345678909", "cpf")).toBe("***.***.***-**");
  });
  it("mascara CNPJ preservando últimos 2 dígitos", () => {
    expect(maskPixKey("12345678000199", "cnpj")).toContain("99");
    expect(maskPixKey("12345678000199", "cnpj")).not.toContain("12345678");
  });
  it("mascara celular no formato +55 DDD 9****-últ4", () => {
    expect(maskPixKey("11999998888", "telefone")).toBe("+55 11 9****-8888");
    expect(maskPixKey("+5511999998888", "telefone")).toBe("+55 11 9****-8888");
  });
  it("mascara chave aleatória (UUID)", () => {
    const m = maskPixKey("550e8400-e29b-41d4-a716-446655440000", "aleatoria");
    expect(m).toBe("550e****0000");
  });
});

// ==========================================================================
// 2. Fluxo E2E
// ==========================================================================

describe("fluxo :: prévia sem persistência", () => {
  it("gera prévia com chave mascarada e NÃO cria favorecido nem gasto", async () => {
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 50 para João Silva chave (11) 99999-8888",
      external_id: "pi-1",
    });
    expect(r.status).toBe("pendente");
    expect(r.resposta).toMatch(/Confira o pagamento Pix/);
    expect(r.resposta).toContain("João Silva");
    expect(r.resposta).toMatch(/R\$\s*50,00/);
    // Chave mascarada — nunca em plain text.
    expect(r.resposta).not.toContain("(11) 99999-8888");
    expect(r.resposta).toContain("8888");
    // Nada persistido.
    expect(gastoInserts()).toHaveLength(0);
    expect(fornecedorInserts()).toHaveLength(0);
  });

  it("chave inválida responde clara SEM abrir sessão", async () => {
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 50 para João chave abc",
      external_id: "pi-inv-1",
    });
    // Cai no parser genérico de gasto (sem chave reconhecível) — não é
    // Pix inline. O que importa: não criou favorecido nem gasto, e a
    // resposta não é a prévia Pix.
    expect(fornecedorInserts()).toHaveLength(0);
    expect(gastoInserts()).toHaveLength(0);
    expect(r.resposta).not.toMatch(/Confira o pagamento Pix/);
  });
});

describe("fluxo :: confirmação (sim/não)", () => {
  it("'sim' cria favorecido + gasto atomicamente", async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 50 para João Silva chave (11) 99999-8888",
      external_id: "pi-c1",
    });
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "sim",
      external_id: "pi-c2",
    });
    expect(r.status).toBe("salva");
    expect(fornecedorInserts()).toHaveLength(1);
    expect(gastoInserts()).toHaveLength(1);
    const gasto = gastoInserts()[0].row as Record<string, unknown>;
    expect(gasto.valor).toBe(5000);
    expect(gasto.forma_pagamento).toBe("pix");
    expect(gasto.estabelecimento).toBe("João Silva");
    // A descrição / observação não pode conter a chave completa.
    expect(String(gasto.observacao ?? "")).not.toContain("(11) 99999-8888");
    expect(String(gasto.descricao ?? "")).not.toContain("(11) 99999-8888");
    // Resposta de sucesso mascara a chave.
    expect(r.resposta).not.toContain("(11) 99999-8888");
    expect(r.resposta).toContain("8888");
  });

  it("'cancelar' não cria nada", async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 50 para João Silva chave (11) 99999-8888",
      external_id: "pi-x1",
    });
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "cancelar",
      external_id: "pi-x2",
    });
    expect(r.status).toBe("cancelada");
    expect(fornecedorInserts()).toHaveLength(0);
    expect(gastoInserts()).toHaveLength(0);
  });

  it("'não' não cria nada", async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 30 para Maria chave maria@ex.com",
      external_id: "pi-n1",
    });
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "não",
      external_id: "pi-n2",
    });
    expect(r.status).toBe("cancelada");
    expect(fornecedorInserts()).toHaveLength(0);
    expect(gastoInserts()).toHaveLength(0);
  });
});

describe("fluxo :: reuso e desambiguação", () => {
  it("reusa silenciosamente favorecido com MESMA chave", async () => {
    resetState({
      favorecidos: [{
        id: "f1", user_id: "u1", nome: "João Silva",
        pix_key: "11999998888", pix_key_type: "telefone", ativo: true,
      }],
    });
    await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 50 para João Silva chave (11) 99999-8888",
      external_id: "pi-r1",
    });
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "sim",
      external_id: "pi-r2",
    });
    expect(r.status).toBe("salva");
    // NÃO criou novo favorecido.
    expect(fornecedorInserts()).toHaveLength(0);
    expect(gastoInserts()).toHaveLength(1);
    const gasto = gastoInserts()[0].row as Record<string, unknown>;
    expect(gasto.fornecedor_id).toBe("f1");
  });

  it("MESMO nome com chave diferente pede desambiguação", async () => {
    resetState({
      favorecidos: [{
        id: "f1", user_id: "u1", nome: "João Silva",
        pix_key: "11988887777", pix_key_type: "telefone", ativo: true,
      }],
    });
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 50 para João Silva chave (11) 99999-8888",
      external_id: "pi-d1",
    });
    expect(r.status).toBe("pendente");
    expect(r.resposta).toMatch(/Já existe um favorecido/i);
    expect(r.resposta).toMatch(/1\.\s*Atualizar/i);
    expect(r.resposta).toMatch(/2\.\s*Salvar como um novo/i);
    expect(r.resposta).toMatch(/3\.\s*Cancelar/i);
    // Não persistiu nada ainda.
    expect(fornecedorInserts()).toHaveLength(0);
    expect(gastoInserts()).toHaveLength(0);
  });
});

describe("fluxo :: idempotência", () => {
  it("reenvio do mesmo external_id na confirmação NÃO duplica gasto", async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 40 para Ana chave 11988887777",
      external_id: "pi-idem-a",
    });
    const a = await processarMensagemWhatsApp({
      telefone, texto: "sim", external_id: "pi-idem-b",
    });
    const b = await processarMensagemWhatsApp({
      telefone, texto: "sim", external_id: "pi-idem-b",
    });
    expect(a.status).toBe("salva");
    expect(b.status).toBe("duplicada");
    expect(gastoInserts()).toHaveLength(1);
    expect(fornecedorInserts()).toHaveLength(1);
  });
});

describe("fluxo :: isolamento por user_id", () => {
  it("favorecido de OUTRO usuário não é reusado", async () => {
    // O fake auth resolve o telefone para user_id "u1". Semeamos um
    // favorecido em outro user_id com a MESMA chave.
    resetState({
      favorecidos: [{
        id: "outro-user-fav", user_id: "u-outro",
        nome: "João Silva",
        pix_key: "11999998888", pix_key_type: "telefone", ativo: true,
      }],
    });
    await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 50 para João Silva chave (11) 99999-8888",
      external_id: "pi-iso1",
    });
    const r = await processarMensagemWhatsApp({
      telefone, texto: "sim", external_id: "pi-iso2",
    });
    expect(r.status).toBe("salva");
    // Criou um NOVO favorecido no user_id correto, não reusou o alheio.
    expect(fornecedorInserts()).toHaveLength(1);
    const novo = fornecedorInserts()[0].row as Record<string, unknown>;
    expect(novo.user_id).toBe("u1");
    expect(novo.id).not.toBe("outro-user-fav");
  });
});

describe("fluxo :: regressões vizinhas", () => {
  it("'salva o pix do João: (11) 99999-8888' continua indo para save_pix", async () => {
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "salva o pix do João: (11) 99999-8888",
      external_id: "reg-1",
    });
    // Ou cria favorecido novo, ou responde de acordo com o handler save.
    // O que importa: não é a prévia do fluxo inline.
    expect(r.resposta).not.toMatch(/Confira o pagamento Pix/);
    expect(gastoInserts()).toHaveLength(0);
  });

  it("'qual o pix do João?' continua indo para query_pix", async () => {
    const r = await processarMensagemWhatsApp({
      telefone, texto: "qual o pix do João?", external_id: "reg-2",
    });
    expect(r.resposta).not.toMatch(/Confira o pagamento Pix/);
    expect(gastoInserts()).toHaveLength(0);
    expect(fornecedorInserts()).toHaveLength(0);
  });

  it("gasto comum com a palavra 'pix' no meio continua sendo gasto genérico", async () => {
    const r = await processarMensagemWhatsApp({
      telefone, texto: "Uber 48,90 pix", external_id: "reg-3",
    });
    // Não é prévia do fluxo inline.
    expect(r.resposta).not.toMatch(/Confira o pagamento Pix/);
  });
});
