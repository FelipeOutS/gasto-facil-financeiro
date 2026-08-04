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
const { processarMensagemWhatsApp } = await import("../src/server/whatsapp.server");
const { _resetShortContext } = await import("../src/server/whatsapp-short-context.server");

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
    expect(detectPagarPixInlineIntent("Pix 50 para João Silva chave (11) 99999-8888")).toBe(true);
  });
  it("aceita 'pra' e 'pro' como preposição", () => {
    expect(detectPagarPixInlineIntent("pix 30 pra Maria chave maria@ex.com")).toBe(true);
    expect(detectPagarPixInlineIntent("Pix 100 pro Pedro chave 12345678901")).toBe(true);
  });
  it("aceita R$ e vírgula decimal", () => {
    expect(detectPagarPixInlineIntent("Pix R$ 50,90 para Ana Costa chave 11988887777")).toBe(true);
  });
  it("aceita CPF, CNPJ, e-mail e UUID (aleatória)", () => {
    expect(detectPagarPixInlineIntent("Pix 10 para X chave 12345678901")).toBe(true);
    expect(detectPagarPixInlineIntent("Pix 10 para X chave 12345678000199")).toBe(true);
    expect(detectPagarPixInlineIntent("Pix 10 para X chave a@b.co")).toBe(true);
    expect(
      detectPagarPixInlineIntent("Pix 10 para X chave 550e8400-e29b-41d4-a716-446655440000"),
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
  it("mascara celular no formato +55 DDD 9∗∗∗∗-últ4 (usa U+2217 para não virar bold no WhatsApp)", () => {
    expect(maskPixKey("11999998888", "telefone")).toBe("+55 11 9∗∗∗∗-8888");
    expect(maskPixKey("+5511999998888", "telefone")).toBe("+55 11 9∗∗∗∗-8888");
  });
  it("mascara chave aleatória (UUID)", () => {
    const m = maskPixKey("550e8400-e29b-41d4-a716-446655440000", "aleatoria");
    expect(m).toBe("550e****0000");
  });
});

// ==========================================================================
// 1b. Desambiguação de chaves numéricas de 11 dígitos (CPF vs celular BR)
// ==========================================================================

describe("parser :: 11 dígitos — desambiguação CPF vs celular", () => {
  it("celular BR com DDD válido + prefixo 9 → telefone (sem máscara)", () => {
    expect(detectPixKeyType("11999998888")).toBe("telefone");
  });
  it("CPF matematicamente válido sem padrão celular → cpf", () => {
    // 111.444.777-35 é um CPF válido; não é padrão celular (3º dígito ≠ 9).
    expect(detectPixKeyType("11144477735")).toBe("cpf");
  });
  it("11 dígitos sem padrão celular e CPF inválido → telefone (fallback conservador)", () => {
    // 12345678901 → 3º dígito=3, não é celular; checksum CPF inválido.
    expect(detectPixKeyType("12345678901")).toBe("telefone");
  });
  it("prefixo +55 sempre classifica como telefone", () => {
    expect(detectPixKeyType("+5511999998888")).toBe("telefone");
  });
  it("máscara CPF explícita força CPF", () => {
    expect(detectPixKeyType("123.456.789-01")).toBe("cpf");
  });
  it("hint 'telefone' força telefone mesmo com padrão de CPF", () => {
    expect(detectPixKeyType("11144477735", "telefone")).toBe("telefone");
  });
  it("hint 'cpf' força CPF mesmo com padrão de celular", () => {
    expect(detectPixKeyType("11999998888", "cpf")).toBe("cpf");
  });
});

describe("parser :: contexto explícito celular/telefone no inline", () => {
  it("'chave celular 11999998888' → telefone", () => {
    const p = parsePagarPixInline("Pix 50 para João chave celular 11999998888");
    expect(p).toBeTruthy();
    expect(p!.pixKeyType).toBe("telefone");
    expect(p!.pixKey).toBe("11999998888");
  });
  it("'telefone 11999998888' (sem 'chave') → telefone", () => {
    const p = parsePagarPixInline("Pix 50 para João telefone 11999998888");
    expect(p).toBeTruthy();
    expect(p!.pixKeyType).toBe("telefone");
  });
  it("'celular 11999998888' (sem 'chave') → telefone", () => {
    const p = parsePagarPixInline("Pix 50 para João celular 11999998888");
    expect(p).toBeTruthy();
    expect(p!.pixKeyType).toBe("telefone");
  });
  it("'chave cpf 11144477735' → cpf mesmo se padrão bater com celular", () => {
    const p = parsePagarPixInline("Pix 50 para Ana chave cpf 11999998888");
    expect(p).toBeTruthy();
    expect(p!.pixKeyType).toBe("cpf");
  });
  it("formato natural 'chave 11999998888' → telefone (celular BR)", () => {
    const p = parsePagarPixInline("Pix 50 para João Silva chave 11999998888");
    expect(p).toBeTruthy();
    expect(p!.pixKeyType).toBe("telefone");
    expect(p!.pixKey).toBe("11999998888");
  });
  it("formato natural 'chave +5511999998888' → telefone", () => {
    const p = parsePagarPixInline("Pix 50 para João Silva chave +5511999998888");
    expect(p).toBeTruthy();
    expect(p!.pixKeyType).toBe("telefone");
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
    // WA-Q-PixInline-Valor-Fix: valor persistido é em REAIS (50.00),
    // não centavos (5000). Prévia dizia R$ 50,00 e o banco recebe 50.
    expect(gasto.valor).toBe(50);
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
      favorecidos: [
        {
          id: "f1",
          user_id: "u1",
          nome: "João Silva",
          pix_key: "11999998888",
          pix_key_type: "telefone",
          ativo: true,
        },
      ],
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
      favorecidos: [
        {
          id: "f1",
          user_id: "u1",
          nome: "João Silva",
          pix_key: "11988887777",
          pix_key_type: "telefone",
          ativo: true,
        },
      ],
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
      telefone,
      texto: "sim",
      external_id: "pi-idem-b",
    });
    const b = await processarMensagemWhatsApp({
      telefone,
      texto: "sim",
      external_id: "pi-idem-b",
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
      favorecidos: [
        {
          id: "outro-user-fav",
          user_id: "u-outro",
          nome: "João Silva",
          pix_key: "11999998888",
          pix_key_type: "telefone",
          ativo: true,
        },
      ],
    });
    await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 50 para João Silva chave (11) 99999-8888",
      external_id: "pi-iso1",
    });
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "sim",
      external_id: "pi-iso2",
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
      telefone,
      texto: "qual o pix do João?",
      external_id: "reg-2",
    });
    expect(r.resposta).not.toMatch(/Confira o pagamento Pix/);
    expect(gastoInserts()).toHaveLength(0);
    expect(fornecedorInserts()).toHaveLength(0);
  });

  it("gasto comum com a palavra 'pix' no meio continua sendo gasto genérico", async () => {
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "Uber 48,90 pix",
      external_id: "reg-3",
    });
    // Não é prévia do fluxo inline.
    expect(r.resposta).not.toMatch(/Confira o pagamento Pix/);
  });
});

// ==========================================================================
// 3. LGPD — chave Pix NUNCA em texto plano em parsed / logs / respostas.
// ==========================================================================

// Interceptor para logs (console.info/warn/error) e cache local. O secret-store
// só emite eventos abstratos como `stage: pix_inline_preview` sem PII.
function withLogCapture<T>(run: () => Promise<T>): Promise<{ res: T; logs: string[] }> {
  const orig = { info: console.info, warn: console.warn, error: console.error };
  const logs: string[] = [];
  const push = (...args: unknown[]) => {
    for (const a of args) {
      try {
        logs.push(typeof a === "string" ? a : JSON.stringify(a));
      } catch {
        logs.push(String(a));
      }
    }
  };
  console.info = push;
  console.warn = push;
  console.error = push;
  return run()
    .then((res) => ({ res, logs }))
    .finally(() => {
      console.info = orig.info;
      console.warn = orig.warn;
      console.error = orig.error;
    });
}

function sessionParsedOf(idx = -1): Record<string, unknown> | null {
  const rows = state.inserts.filter((i) => i.table === "whatsapp_messages");
  const row = idx < 0 ? rows[rows.length + idx] : rows[idx];
  const p = row?.row?.parsed as Record<string, unknown> | undefined;
  return p ?? null;
}

function pixSecretsCount(): number {
  return state.pixPendingSecretsData.length;
}

describe("LGPD :: chave Pix nunca vaza em parsed / logs / respostas", () => {
  const KEY_FULL = "11999998888";
  const KEY_FULL_MASKED_INPUT = "(11) 99999-8888";

  it("prévia: parsed NÃO contém a chave completa (só masked+type+secretId+hash)", async () => {
    const { logs } = await withLogCapture(async () => {
      const r = await processarMensagemWhatsApp({
        telefone,
        texto: `Pix 50 para João Silva chave ${KEY_FULL_MASKED_INPUT}`,
        external_id: "lgpd-a1",
      });
      expect(r.status).toBe("pendente");
    });
    const parsed = sessionParsedOf();
    expect(parsed).toBeTruthy();
    // Estrutura esperada: masked/type/secretId/hash — nunca plaintext.
    expect(parsed).toMatchObject({
      pendingPixKeyType: "telefone",
      pendingPixKeyMasked: expect.any(String),
      pendingPixSecretId: expect.any(String),
      pendingPixKeyHash: expect.any(String),
    });
    // Campos plaintext antigos são proibidos.
    expect(parsed).not.toHaveProperty("pendingPixKey");
    // Serialização de TODO o parsed jamais deve conter a chave.
    const serial = JSON.stringify(parsed);
    expect(serial).not.toContain(KEY_FULL);
    expect(serial).not.toContain(KEY_FULL_MASKED_INPUT);
    // Nem logs devem conter a chave.
    for (const l of logs) {
      expect(l).not.toContain(KEY_FULL);
      expect(l).not.toContain(KEY_FULL_MASKED_INPUT);
    }
  });

  it("resposta de prévia NUNCA contém a chave completa", async () => {
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: `Pix 50 para João Silva chave ${KEY_FULL_MASKED_INPUT}`,
      external_id: "lgpd-a2",
    });
    expect(r.resposta).not.toContain(KEY_FULL);
    expect(r.resposta).not.toContain(KEY_FULL_MASKED_INPUT);
    // Sanity — a máscara aparece com U+2217 e os 4 últimos dígitos.
    expect(r.resposta).toMatch(/\+55 11 9∗∗∗∗-8888/);
  });

  it("secret-store recebeu ciphertext (nunca plaintext)", async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: `Pix 50 para João Silva chave ${KEY_FULL_MASKED_INPUT}`,
      external_id: "lgpd-a3",
    });
    expect(pixSecretsCount()).toBe(1);
    const row = state.pixPendingSecretsData[0];
    // Ciphertext existe e NÃO revela a chave.
    expect(String(row.key_ciphertext ?? "")).not.toContain(KEY_FULL);
    expect(String(row.key_ciphertext ?? "").length).toBeGreaterThan(10);
    expect(row.key_type).toBe("telefone");
    // Hash é HMAC — não reversível para plaintext direto.
    expect(String(row.key_hash ?? "")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("cancelamento apaga o secret cifrado", async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: `Pix 50 para João Silva chave ${KEY_FULL_MASKED_INPUT}`,
      external_id: "lgpd-b1",
    });
    expect(pixSecretsCount()).toBe(1);
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "cancelar",
      external_id: "lgpd-b2",
    });
    expect(r.status).toBe("cancelada");
    expect(pixSecretsCount()).toBe(0);
  });

  it("'não' também apaga o secret cifrado", async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: `Pix 40 para Ana chave ${KEY_FULL_MASKED_INPUT}`,
      external_id: "lgpd-b3",
    });
    expect(pixSecretsCount()).toBe(1);
    await processarMensagemWhatsApp({
      telefone,
      texto: "não",
      external_id: "lgpd-b4",
    });
    expect(pixSecretsCount()).toBe(0);
  });

  it("confirmação 'sim' apaga o secret e persiste favorecido + gasto", async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: `Pix 50 para João Silva chave ${KEY_FULL_MASKED_INPUT}`,
      external_id: "lgpd-c1",
    });
    expect(pixSecretsCount()).toBe(1);
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "sim",
      external_id: "lgpd-c2",
    });
    expect(r.status).toBe("salva");
    expect(pixSecretsCount()).toBe(0);
    // Favorecido foi criado COM a chave completa normalizada
    // (persistência funcionando).
    expect(fornecedorInserts()).toHaveLength(1);
    const fav = fornecedorInserts()[0].row as Record<string, unknown>;
    expect(fav.pix_key).toBe(KEY_FULL);
    expect(fav.pix_key_type).toBe("telefone");
    // Gasto não vaza chave em descrição/observação.
    const gasto = gastoInserts()[0].row as Record<string, unknown>;
    expect(String(gasto.observacao ?? "")).not.toContain(KEY_FULL);
    expect(String(gasto.descricao ?? "")).not.toContain(KEY_FULL);
  });

  it("secret expirado → sessão pede reenvio (sem persistir)", async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: `Pix 50 para João Silva chave ${KEY_FULL_MASKED_INPUT}`,
      external_id: "lgpd-e1",
    });
    // Simula expiração forçando expires_at no passado.
    for (const row of state.pixPendingSecretsData) {
      row.expires_at = new Date(Date.now() - 60_000).toISOString();
    }
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "sim",
      external_id: "lgpd-e2",
    });
    expect(r.status).toBe("erro");
    expect(r.resposta).toMatch(/expirou/i);
    // Nada persistido.
    expect(gastoInserts()).toHaveLength(0);
    expect(fornecedorInserts()).toHaveLength(0);
    // E o secret expirado foi removido (consumePendingPixKey apaga).
    expect(pixSecretsCount()).toBe(0);
  });
});

// ==========================================================================
// 4. UX — rótulo "Celular" + formato Chave Pix: <tipo> \n mask
// ==========================================================================

describe("UX :: rótulo do celular exibido como 'Celular'", () => {
  it("prévia mostra 'Chave Pix: Celular' e máscara em nova linha", async () => {
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 50 para João Silva chave +5511999998888",
      external_id: "ux-1",
    });
    expect(r.resposta).toMatch(/Chave Pix:\s*Celular/);
    expect(r.resposta).toMatch(/\+55 11 9∗∗∗∗-8888/);
    // Nunca mais o formato antigo "(telefone)".
    expect(r.resposta).not.toMatch(/\(telefone\)/);
  });
  it("sucesso após 'sim' também usa 'Celular' e máscara em duas linhas", async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 20 para Ana chave 11988887777",
      external_id: "ux-2a",
    });
    const r = await processarMensagemWhatsApp({
      telefone,
      texto: "sim",
      external_id: "ux-2b",
    });
    expect(r.resposta).toMatch(/Chave Pix:\s*Celular/);
    expect(r.resposta).not.toMatch(/\(telefone\)/);
  });
});

// ==========================================================================
// 4. WA-Q-PixInline-Valor-Fix — regressão de unidade monetária
// ==========================================================================

const { centavosParaReais } = await import("../src/server/whatsapp-pagar-pessoa-flow.server");

describe("valor :: centavosParaReais (helper puro)", () => {
  it("converte 5000 centavos em 50 reais", () => {
    expect(centavosParaReais(5000)).toBe(50);
  });
  it("converte 1 centavo em 0.01 real", () => {
    expect(centavosParaReais(1)).toBe(0.01);
  });
  it("converte 100 centavos em 1 real", () => {
    expect(centavosParaReais(100)).toBe(1);
  });
  it("preserva duas casas em 5055 → 50.55", () => {
    expect(centavosParaReais(5055)).toBe(50.55);
  });
  it("blinda entradas não-finitas", () => {
    expect(centavosParaReais(Number.NaN)).toBe(0);
    expect(centavosParaReais(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("valor :: prévia == banco (não grava 100× maior)", () => {
  async function runPreviaEConfirmacao(texto: string, tag: string) {
    const previa = await processarMensagemWhatsApp({
      telefone,
      texto,
      external_id: `${tag}-1`,
    });
    const sim = await processarMensagemWhatsApp({
      telefone,
      texto: "sim",
      external_id: `${tag}-2`,
    });
    return { previa, sim };
  }

  it("R$ 50,00: prévia mostra 50,00 e banco recebe 50", async () => {
    const { previa, sim } = await runPreviaEConfirmacao(
      "Pix 50 para João Silva chave (11) 99999-8888",
      "val-50",
    );
    expect(previa.resposta).toMatch(/R\$\s*50,00/);
    expect(sim.status).toBe("salva");
    const gasto = gastoInserts()[0].row as Record<string, unknown>;
    expect(gasto.valor).toBe(50);
    expect(gasto.valor).not.toBe(5000);
  });

  it("R$ 0,01: prévia mostra 0,01 e banco recebe 0.01", async () => {
    const { previa, sim } = await runPreviaEConfirmacao(
      "Pix 0,01 para Ana chave ana@ex.com",
      "val-1c",
    );
    expect(previa.resposta).toMatch(/R\$\s*0,01/);
    expect(sim.status).toBe("salva");
    const gasto = gastoInserts()[0].row as Record<string, unknown>;
    expect(gasto.valor).toBe(0.01);
  });

  it("R$ 1,00: prévia mostra 1,00 e banco recebe 1", async () => {
    const { sim } = await runPreviaEConfirmacao("Pix 1 para Pedro chave 12345678901", "val-1");
    expect(sim.status).toBe("salva");
    const gasto = gastoInserts()[0].row as Record<string, unknown>;
    expect(gasto.valor).toBe(1);
  });

  it("R$ 50,55: preserva centavos exatos no banco", async () => {
    const { previa, sim } = await runPreviaEConfirmacao(
      "Pix 50,55 para Ana Costa chave 11988887777",
      "val-5055",
    );
    expect(previa.resposta).toMatch(/R\$\s*50,55/);
    expect(sim.status).toBe("salva");
    const gasto = gastoInserts()[0].row as Record<string, unknown>;
    expect(gasto.valor).toBe(50.55);
  });

  it("idempotência: mesmo external_id no 'sim' cria apenas 1 gasto", async () => {
    await processarMensagemWhatsApp({
      telefone,
      texto: "Pix 50 para João Silva chave (11) 99999-8888",
      external_id: "val-idem-1",
    });
    await processarMensagemWhatsApp({
      telefone,
      texto: "sim",
      external_id: "val-idem-2",
    });
    await processarMensagemWhatsApp({
      telefone,
      texto: "sim",
      external_id: "val-idem-2",
    });
    expect(gastoInserts()).toHaveLength(1);
    expect((gastoInserts()[0].row as Record<string, unknown>).valor).toBe(50);
  });
});
