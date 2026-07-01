/**
 * WA-Q-Hardening — Testes do Safety Net de Roteamento de Consultas.
 *
 * Cobertura:
 *   1. Positivos  — mensagens consultivas (menu, ajuda, gaps sem handler)
 *                    devem devolver `kind='fallback'`.
 *   2. Negativos  — comandos de lançamento/edição/baixa devem devolver `pass`.
 *   3. Regressão — intents já implementadas continuam sendo `pass` (o guard
 *                   nem chega a ver, mas se chegasse, algumas frases genéricas
 *                   como "meus gastos" também são query-shape; para essas,
 *                   o guard SÓ é chamado quando `detectConsultaIntent` já
 *                   retornou null. Aqui testamos apenas o formato do guard).
 */
import { describe, it, expect } from "vitest";
import { detectConsultaShape } from "../src/server/whatsapp-query-guard.server";

function isFallback(t: string) {
  const r = detectConsultaShape(t);
  expect(r.kind, `expected fallback for "${t}"`).toBe("fallback");
  if (r.kind === "fallback") {
    expect(r.resposta.length).toBeGreaterThan(20);
  }
}

function isPass(t: string) {
  const r = detectConsultaShape(t);
  expect(r.kind, `expected pass for "${t}"`).toBe("pass");
}

describe("WA-Q-Hardening — detectConsultaShape (positivos = fallback)", () => {
  describe("áreas sem handler dedicado (gaps)", () => {
    const gaps = [
      // cartões
      "meus cartões",
      "meus cartoes",
      "quais são meus cartões",
      "listar cartões",
      // bancos
      "meus bancos",
      "minhas contas bancárias",
      "meu saldo",
      "quais são meus saldos",
      // boletos
      "meus boletos",
      "boletos em aberto",
      // favorecidos / pix
      "meus favorecidos",
      "minhas chaves pix",
      "meus contatos pix",
      // assinatura
      "minha assinatura",
      "meu plano",
      // investimentos
      "meus investimentos",
      "minha carteira",
      "meus rendimentos",
      // dinheiro guardado / reservas
      "meu dinheiro guardado",
      "minhas reservas",
      "minha poupança",
      // categorias
      "minhas categorias",
      "listar categorias",
      // histórico genérico
      "meu histórico",
      "meus lançamentos",
      // impacto na renda
      "impacto dos gastos na renda",
      "gastos na renda",
    ];
    for (const t of gaps) {
      it(`fallback para "${t}"`, () => isFallback(t));
    }
  });

  describe("consulta genérica desconhecida (query-shape sem área)", () => {
    const genericos = [
      "quais são minhas opções de consulta",
      "quanto tenho pendentes",
      "listar tudo",
      "ver todas",
      "onde estou",
    ];
    for (const t of genericos) {
      it(`fallback genérico para "${t}"`, () => isFallback(t));
    }
  });
});

describe("WA-Q-Hardening — detectConsultaShape (negativos = pass, deixa parser)", () => {
  describe("lançamentos de gasto/receita em texto livre", () => {
    const lancamentos = [
      "Uber 29,90 hoje no Pix",
      "Uber R$ 29,90",
      "Mercado 148 ontem no cartão Nubank",
      "Almoço 35 débito",
      "Recebi 3500 de salário hoje",
      "Ganhei 200 de freela",
      "Gastei 50 reais no mercado",
      "Comprei tênis 299,90 no crédito 3x",
    ];
    for (const t of lancamentos) {
      it(`pass para "${t}"`, () => isPass(t));
    }
  });

  describe("criação/edição/baixa/cancelamento de contas", () => {
    const escrita = [
      "Cadastrar internet 119,90 vence dia 5",
      "Nova conta aluguel 1500 vence 10/07",
      "Criar conta luz 230 venc 15/07",
      "Paguei a internet",
      "Quitei o aluguel ontem",
      "Adiar a luz para sexta",
      "Cancelar a conta do streaming",
      "Editar aluguel",
      "Alterar vencimento da internet",
    ];
    for (const t of escrita) {
      it(`pass para "${t}"`, () => isPass(t));
    }
  });

  describe("respostas dentro de sessão (curtas, sem forma consultiva)", () => {
    const respostas = [
      "sim",
      "não",
      "nao",
      "pix",
      "débito",
      "crédito",
      "todo mês",
      "dia 5",
      "1",
      "2",
      "confirmar",
      "cancelar",
    ];
    for (const t of respostas) {
      it(`pass para "${t}"`, () => isPass(t));
    }
  });

  describe("frases vazias ou apenas espaço", () => {
    it("pass para string vazia", () => isPass(""));
    it("pass para whitespace", () => isPass("   "));
  });

  describe("comandos de pagamento a pessoa (Pix / gradual)", () => {
    const pag = [
      "Paguei João",
      "Paguei o Pedro",
      "Paguei 50 ao João do almoço",
    ];
    for (const t of pag) {
      it(`pass para "${t}"`, () => isPass(t));
    }
  });
});

describe("WA-Q-Hardening — respostas seguras", () => {
  it("resposta genérica menciona menu e site/app", () => {
    const r = detectConsultaShape("quais opções tenho para consultar");
    expect(r.kind).toBe("fallback");
    if (r.kind === "fallback") {
      expect(r.resposta).toMatch(/menu/i);
      expect(r.resposta).toMatch(/site|app/i);
      // NÃO deve pedir valor.
      expect(r.resposta).not.toMatch(/valor/i);
      expect(r.resposta).not.toMatch(/quanto foi/i);
    }
  });

  it("resposta de cartões orienta para faturas", () => {
    const r = detectConsultaShape("meus cartões");
    expect(r.kind).toBe("fallback");
    if (r.kind === "fallback") {
      expect(r.area).toBe("cartoes");
      expect(r.resposta).toMatch(/fatura/i);
    }
  });

  it("resposta de boletos orienta para envio de foto/pdf", () => {
    const r = detectConsultaShape("meus boletos");
    expect(r.kind).toBe("fallback");
    if (r.kind === "fallback") {
      expect(r.area).toBe("boletos");
      expect(r.resposta).toMatch(/foto|pdf|linha digit/i);
    }
  });

  it("nenhuma resposta pede valor ao usuário", () => {
    const casos = [
      "meus cartões",
      "meus bancos",
      "meus boletos",
      "meus favorecidos",
      "minha assinatura",
      "meus investimentos",
      "minhas reservas",
      "minhas categorias",
      "meu histórico",
      "impacto dos gastos na renda",
    ];
    for (const t of casos) {
      const r = detectConsultaShape(t);
      expect(r.kind).toBe("fallback");
      if (r.kind === "fallback") {
        expect(r.resposta, t).not.toMatch(/qual foi o valor/i);
        expect(r.resposta, t).not.toMatch(/quanto foi/i);
        expect(r.resposta, t).not.toMatch(/me diga o valor/i);
      }
    }
  });
});
