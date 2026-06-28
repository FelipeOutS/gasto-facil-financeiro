/**
 * WA-R1-Fix — Persistência atômica de RECEITA RECORRENTE.
 *
 * Antes: o fluxo pré-projetava 12 receitas futuras e gravava recorrencia_id
 *        fantasma (sem linha em `recorrencias`).
 * Agora: a RPC `create_recurring_income` cria atomicamente 1 receita atual +
 *        1 recorrência ativa com `proxima_cobranca` estritamente futura,
 *        com Readback Guard antes de declarar sucesso.
 *
 * Cobertura:
 *  - receita única não recorrente: 1 linha, sem recorrência;
 *  - receita recorrente "hoje + dia 5": exatamente 1 receita atual + 1
 *    recorrência mensal, próxima ocorrência = próximo dia 5 estritamente
 *    futuro; vínculo recorrencia_id real;
 *  - zero pré-projeção em `receitas`;
 *  - falha na RPC: zero receita e zero recorrência (rollback completo);
 *  - readback inconsistente: nenhum sucesso falso;
 *  - retry após falha (novo external_id) é idempotente — termina com
 *    exatamente 1 receita + 1 recorrência válidas.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import "./_whatsapp-fake";
import {
  resetState,
  state,
  fakeAdmin,
  receitasInserts,
  recorrenciasInserts,
} from "./_whatsapp-fake";

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

describe("WA-R1-Fix — receita não recorrente", () => {
  beforeEach(() => resetState());

  it("cria exatamente 1 receita e nenhuma recorrência", async () => {
    await processarMensagemWhatsApp(msg("Recebi 3500 de salário hoje", "e-prev"));
    await processarMensagemWhatsApp(msg("não", "e-rec-1")); // não recorrente
    const out = await processarMensagemWhatsApp(msg("sim", "e-rec-2")); // confirma
    expect(out.status).toBe("salva");
    const recs = receitasInserts();
    expect(recs.length).toBe(1);
    expect(recs[0].row.recorrente).toBe(false);
    expect(recs[0].row.recorrencia_id).toBeUndefined();
    expect(recorrenciasInserts().length).toBe(0);
  });
});

describe("WA-R1-Fix — receita recorrente mensal dia 5", () => {
  beforeEach(() => resetState());

  it("cria 1 receita atual + 1 recorrência ativa, sem pré-projeção, próxima futura, vínculo real", async () => {
    await processarMensagemWhatsApp(msg("Recebi 3500 de salário hoje", "e-prev"));
    await processarMensagemWhatsApp(msg("sim", "e-rec-1")); // confirma "é recorrente"
    await processarMensagemWhatsApp(msg("todo mês", "e-rec-2"));
    await processarMensagemWhatsApp(msg("dia 5", "e-rec-3"));
    const out = await processarMensagemWhatsApp(msg("sim", "e-rec-4"));
    expect(out.status).toBe("salva");

    const recs = receitasInserts();
    const recos = recorrenciasInserts();

    // Exatamente 1 receita atual (sem pré-projeção de 12 meses)
    expect(recs.length).toBe(1);
    expect(recos.length).toBe(1);

    const receita = recs[0].row as Record<string, unknown>;
    const recorrencia = recos[0].row as Record<string, unknown>;

    expect(receita.recorrente).toBe(true);
    expect(Number(receita.valor)).toBe(3500);
    // Vínculo recorrencia_id REAL — aponta para uma linha que existe
    expect(receita.recorrencia_id).toBe(recorrencia.id as string);

    // Recorrência ativa, mensal, próxima cobrança estritamente futura
    expect(recorrencia.status).toBe("ativa");
    expect(recorrencia.frequencia).toBe("mensal");
    const prox = String(recorrencia.proxima_cobranca);
    const hoje = String(receita.data);
    expect(prox > hoje).toBe(true);
    expect(prox.endsWith("-05")).toBe(true);
  });
});

describe("WA-R1-Fix — rollback e idempotência", () => {
  beforeEach(() => resetState());

  it("RPC falha: zero receita e zero recorrência", async () => {
    const original = fakeAdmin.rpc;
    fakeAdmin.rpc = (async (name: string, args?: Record<string, unknown>) => {
      if (name === "create_recurring_income") {
        return { data: null, error: { message: "boom" } };
      }
      return original(name, args);
    }) as typeof fakeAdmin.rpc;
    try {
      await processarMensagemWhatsApp(msg("Recebi 3500 de salário hoje", "e-prev"));
      await processarMensagemWhatsApp(msg("sim", "e-rec-1"));
      await processarMensagemWhatsApp(msg("todo mês", "e-rec-2"));
      await processarMensagemWhatsApp(msg("dia 5", "e-rec-3"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-rec-4"));
      expect(out.status).not.toBe("salva");
      expect(receitasInserts().length).toBe(0);
      expect(recorrenciasInserts().length).toBe(0);
    } finally {
      fakeAdmin.rpc = original;
    }
  });

  it("Readback inconsistente (RPC retorna shape inválido): sem sucesso falso", async () => {
    const original = fakeAdmin.rpc;
    fakeAdmin.rpc = (async (name: string, args?: Record<string, unknown>) => {
      if (name === "create_recurring_income") {
        // shape inesperado: missing receita_id
        return { data: [{ recorrencia_id: "fantasma" }], error: null };
      }
      return original(name, args);
    }) as typeof fakeAdmin.rpc;
    try {
      await processarMensagemWhatsApp(msg("Recebi 3500 de salário hoje", "e-prev"));
      await processarMensagemWhatsApp(msg("sim", "e-rec-1"));
      await processarMensagemWhatsApp(msg("todo mês", "e-rec-2"));
      await processarMensagemWhatsApp(msg("dia 5", "e-rec-3"));
      const out = await processarMensagemWhatsApp(msg("sim", "e-rec-4"));
      expect(out.status).not.toBe("salva");
      // estado não pode conter um vínculo fantasma persistido na tabela receitas
      expect(receitasInserts().filter((r) => r.row.recorrente === true).length).toBe(0);
    } finally {
      fakeAdmin.rpc = original;
    }
  });

  it("Retry após falha (novo external_id): termina com exatamente 1 receita + 1 recorrência", async () => {
    const original = fakeAdmin.rpc;
    let fail = true;
    fakeAdmin.rpc = (async (name: string, args?: Record<string, unknown>) => {
      if (name === "create_recurring_income" && fail) {
        return { data: null, error: { message: "transient" } };
      }
      return original(name, args);
    }) as typeof fakeAdmin.rpc;
    try {
      await processarMensagemWhatsApp(msg("Recebi 3500 de salário hoje", "e-prev"));
      await processarMensagemWhatsApp(msg("sim", "e-rec-1"));
      await processarMensagemWhatsApp(msg("todo mês", "e-rec-2"));
      await processarMensagemWhatsApp(msg("dia 5", "e-rec-3"));
      const bad = await processarMensagemWhatsApp(msg("sim", "e-rec-bad"));
      expect(bad.status).not.toBe("salva");
      expect(receitasInserts().length).toBe(0);
      expect(recorrenciasInserts().length).toBe(0);

      // Retry com novo external_id
      fail = false;
      const ok = await processarMensagemWhatsApp(msg("sim", "e-rec-retry"));
      expect(ok.status).toBe("salva");
      expect(receitasInserts().length).toBe(1);
      expect(recorrenciasInserts().length).toBe(1);
      // sem 12 linhas órfãs
      expect(state.receitasData.length).toBe(1);
    } finally {
      fakeAdmin.rpc = original;
    }
  });
});
