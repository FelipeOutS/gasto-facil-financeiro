/**
 * WA-PIX-3.26 — Rejeição estrita de chave Pix inválida no `salvar_pix`.
 *
 * Bug capturado no smoke:
 *   "salva pix do Marcos chave 12345" → aceito, favorecido criado com
 *   pix_key="12345", pix_key_type="desconhecida".
 *
 * Contrato pós-fix:
 *   - handler NUNCA cria/atualiza favorecido quando a chave é inválida
 *     (tipo `desconhecida`, CPF/CNPJ com dígito errado, telefone sem
 *     DDD, email malformado, UUID inválido, texto genérico);
 *   - resposta orienta o usuário com a lista de formatos aceitos;
 *   - zero sessão pendente, zero claim, zero gasto;
 *   - chave inválida NUNCA persistida em `fornecedores.pix_key` nem em
 *     `whatsapp_pix_pending_secrets`;
 *   - tentativa inválida em favorecido existente NÃO sobrescreve chave
 *     válida já cadastrada;
 *   - isolamento por user_id: rejeição de u1 não afeta u2.
 */
import "./_whatsapp-fake";
import { describe, it, expect, beforeEach } from "bun:test";
import { resetState, state, setupWhatsAppFakeMocks } from "./_whatsapp-fake";
setupWhatsAppFakeMocks();

const { isValidPixKey, detectPixKeyType } = await import("../src/server/whatsapp-pix-parser");
const { handleSavePixIntent } = await import("../src/server/whatsapp-pix-intents.server");
const { _resetShortContext } = await import("../src/server/whatsapp-short-context.server");

const userId = "u1";
const telefone = "5511999998888";
const fakeRow = {
  external_id: "ext-326",
  telefone,
  texto: "",
  recebida_em: new Date().toISOString(),
} as never;

function fornecedorInserts() {
  return state.inserts.filter((i) => i.table === "fornecedores");
}
function pendingSecretInserts() {
  return state.inserts.filter((i) => i.table === "whatsapp_pix_pending_secrets");
}

// -------------------------------------------------------------------------
// isValidPixKey — validador puro
// -------------------------------------------------------------------------
describe("WA-PIX-3.26 :: isValidPixKey", () => {
  it("email válido", () => {
    expect(isValidPixKey("email", "joao@email.com")).toBe(true);
  });
  it("email inválido", () => {
    expect(isValidPixKey("email", "joao@")).toBe(false);
    expect(isValidPixKey("email", "sem-arroba")).toBe(false);
  });
  it("telefone celular BR com DDD (11 dígitos)", () => {
    expect(isValidPixKey("telefone", "11999998888")).toBe(true);
  });
  it("telefone com +55 (13 dígitos)", () => {
    expect(isValidPixKey("telefone", "+5511999998888")).toBe(true);
  });
  it("telefone sem DDD ou fixo → inválido", () => {
    expect(isValidPixKey("telefone", "999998888")).toBe(false);
    expect(isValidPixKey("telefone", "1133334444")).toBe(false); // fixo, sem 9
    expect(isValidPixKey("telefone", "12345")).toBe(false);
  });
  it("CPF válido (111.444.777-35)", () => {
    expect(isValidPixKey("cpf", "11144477735")).toBe(true);
  });
  it("CPF com dígito verificador errado", () => {
    expect(isValidPixKey("cpf", "12345678900")).toBe(false);
    expect(isValidPixKey("cpf", "11111111111")).toBe(false);
  });
  it("CNPJ válido (11.222.333/0001-81)", () => {
    expect(isValidPixKey("cnpj", "11222333000181")).toBe(true);
  });
  it("CNPJ com dígito errado", () => {
    expect(isValidPixKey("cnpj", "12345678000199")).toBe(false);
  });
  it("UUID válido é aleatoria", () => {
    expect(isValidPixKey("aleatoria", "550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });
  it("UUID inválido rejeita", () => {
    expect(isValidPixKey("aleatoria", "abc-123")).toBe(false);
    expect(isValidPixKey("aleatoria", "12345")).toBe(false);
  });
  it("tipo desconhecida sempre inválido", () => {
    expect(isValidPixKey("desconhecida", "12345")).toBe(false);
    expect(isValidPixKey("desconhecida", "qualquer coisa")).toBe(false);
  });
});

// -------------------------------------------------------------------------
// Handler — bug canônico do smoke
// -------------------------------------------------------------------------
describe("WA-PIX-3.26 :: handleSavePixIntent rejeita chave inválida", () => {
  beforeEach(() => {
    resetState({});
    _resetShortContext();
  });

  const casosInvalidos: Array<[string, string]> = [
    ["salva pix do Marcos chave 12345", "12345"],
    ["salva pix do Pedro cpf 12345678900", "cpf inválido"],
    ["cadastra pix do Ana cnpj 12345678000199", "cnpj inválido"],
    ["salva o Pix do João: joao@", "email inválido"],
    ["salva pix da Marta chave abc-123", "aleatoria inválida"],
    ["salva pix do Rui telefone 12345", "telefone curto"],
  ];

  for (const [texto, label] of casosInvalidos) {
    it(`rejeita ${label}: ${JSON.stringify(texto)}`, async () => {
      const out = await handleSavePixIntent({
        userId,
        telefone,
        texto,
        _row: fakeRow,
      });
      expect(out.status).toBe("sem_pendencia");
      expect(out.resposta).toMatch(/Não reconheci essa chave Pix/i);
      expect(out.resposta).toMatch(/CPF, CNPJ, e-mail, celular/i);
      expect(fornecedorInserts()).toHaveLength(0);
      expect(pendingSecretInserts()).toHaveLength(0);
      expect(state.favorecidosData.length).toBe(0);
    });
  }
});

// -------------------------------------------------------------------------
// Handler — chave válida ainda funciona
// -------------------------------------------------------------------------
describe("WA-PIX-3.26 :: chaves válidas continuam sendo aceitas", () => {
  beforeEach(() => {
    resetState({});
    _resetShortContext();
  });

  it("email válido cria favorecido", async () => {
    const out = await handleSavePixIntent({
      userId,
      telefone,
      texto: "salva o Pix do João: joao@email.com",
      _row: fakeRow,
    });
    expect(out.status).toBe("salva");
    expect(fornecedorInserts()).toHaveLength(1);
  });

  it("celular BR com DDD (11 dígitos) cria favorecido", async () => {
    const out = await handleSavePixIntent({
      userId,
      telefone,
      texto: "salva o Pix da Maria: 11999998888",
      _row: fakeRow,
    });
    expect(out.status).toBe("salva");
    expect(fornecedorInserts()).toHaveLength(1);
    const row = fornecedorInserts()[0].row as { pix_key_type?: string };
    expect(row.pix_key_type).toBe("telefone");
  });

  it("CPF válido cria favorecido", async () => {
    const out = await handleSavePixIntent({
      userId,
      telefone,
      texto: "cadastra Pix do Pedro CPF 111.444.777-35",
      _row: fakeRow,
    });
    expect(out.status).toBe("salva");
    expect(fornecedorInserts()).toHaveLength(1);
    const row = fornecedorInserts()[0].row as {
      pix_key?: string;
      pix_key_type?: string;
    };
    expect(row.pix_key_type).toBe("cpf");
    expect(row.pix_key).toBe("11144477735");
  });
});

// -------------------------------------------------------------------------
// Handler — tentativa inválida NÃO sobrescreve chave válida existente
// -------------------------------------------------------------------------
describe("WA-PIX-3.26 :: chave inválida NÃO sobrescreve favorecido existente", () => {
  it("Marcos com chave válida cadastrada não é alterado por 'chave 12345'", async () => {
    resetState({
      favorecidos: [
        {
          id: "fmarcos",
          user_id: userId,
          nome: "Marcos",
          apelido: null,
          ativo: true,
          pix_key: "marcos@email.com",
          pix_key_type: "email",
        },
      ],
    });
    _resetShortContext();

    const out = await handleSavePixIntent({
      userId,
      telefone,
      texto: "salva pix do Marcos chave 12345",
      _row: fakeRow,
    });
    expect(out.status).toBe("sem_pendencia");
    expect(out.resposta).toMatch(/Não reconheci essa chave Pix/i);

    // Nenhum update foi emitido, chave original preservada.
    const row = state.favorecidosData[0] as {
      pix_key?: string;
      pix_key_type?: string;
    };
    expect(row.pix_key).toBe("marcos@email.com");
    expect(row.pix_key_type).toBe("email");
    // Nenhum insert também.
    expect(fornecedorInserts()).toHaveLength(0);
  });
});
