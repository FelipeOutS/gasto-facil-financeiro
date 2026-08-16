import { describe, it, expect } from "vitest";
import {
  detectarTransferencia,
  resolverTipoMovimentacao,
} from "@/lib/transferencia-detect";
import { extrairFinaisCartao, sugerirCartaoDaFatura } from "@/lib/fatura-cartao-match";
import type { Cartao } from "@/lib/types";

const cartao = (id: string, nome: string, banco: string): Cartao =>
  ({ id, nome, banco, cor: "#000" }) as unknown as Cartao;

describe("detectarTransferencia", () => {
  it("reconhece movimentação entre contas do próprio titular", () => {
    expect(detectarTransferencia("Transferência entre contas").classe).toBe(
      "transferencia_interna",
    );
    expect(detectarTransferencia("Aplicação automática poupança").classe).toBe(
      "transferencia_interna",
    );
    expect(detectarTransferencia("Envio para cofrinho").classe).toBe("transferencia_interna");
  });

  it("reconhece pagamento a terceiro como movimentação real", () => {
    expect(detectarTransferencia("Pagamento boleto energia").classe).toBe("terceiro");
    expect(detectarTransferencia("Compra supermercado ltda").classe).toBe("terceiro");
  });

  it("marca como incerta a transferência sem titularidade", () => {
    const d = detectarTransferencia("PIX");
    expect(d.classe).toBe("incerta");
    expect(d.certeza).toBe("baixa");
  });
});

describe("resolverTipoMovimentacao", () => {
  it("usa o sinal do valor para gasto e receita", () => {
    expect(resolverTipoMovimentacao("Compra padaria", -30).tipo).toBe("despesa");
    expect(resolverTipoMovimentacao("Salário mensal", 5000).tipo).toBe("receita");
  });

  it("transferência interna não vira gasto nem receita", () => {
    const r = resolverTipoMovimentacao("Transferência interna", -100);
    expect(r.tipo).toBe("transferencia_interna");
    expect(r.precisaRevisao).toBe(false);
  });

  it("pede revisão quando a titularidade é desconhecida", () => {
    const r = resolverTipoMovimentacao("TED", -250);
    expect(r.tipo).toBe("despesa");
    expect(r.precisaRevisao).toBe(true);
  });
});

describe("sugerirCartaoDaFatura", () => {
  it("extrai finais citados no texto", () => {
    expect(extrairFinaisCartao("fatura final 1234")).toContain("1234");
    expect(extrairFinaisCartao("•••• 9876")).toContain("9876");
  });

  it("sugere o único cartão cadastrado", () => {
    const s = sugerirCartaoDaFatura([cartao("a", "Roxinho", "Nubank")], ["fatura.pdf"]);
    expect(s?.cartaoId).toBe("a");
  });

  it("sugere pelo banco quando há vários cartões", () => {
    const s = sugerirCartaoDaFatura(
      [cartao("a", "Roxinho", "Nubank"), cartao("b", "Gold", "Itaú")],
      ["fatura-nubank-agosto.pdf"],
    );
    expect(s?.cartaoId).toBe("a");
  });

  it("não sugere nada quando não há pista", () => {
    const s = sugerirCartaoDaFatura(
      [cartao("a", "Roxinho", "Nubank"), cartao("b", "Gold", "Itaú")],
      ["extrato.pdf"],
    );
    expect(s).toBeNull();
  });
});
