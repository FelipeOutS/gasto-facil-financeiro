import { describe, it, expect, mock } from "bun:test";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const { criarCartaoViaWhatsApp } = await import("@/server/cartao-cadastro.server");

type Link = { telefone: string; user_id: string; ativo: boolean; opt_in_em: string | null; revogado_em: string | null };
function fakeAdmin(links: Link[]) {
  const inserts: unknown[] = [];
  const admin = {
    from(t: string) {
      if (t === "whatsapp_links")
        return { select: () => ({ in: (_c: string, v: string[]) => ({ limit: async () => ({ data: links.filter((l) => v.includes(l.telefone)), error: null }) }) }) };
      return {
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        insert: async (row: unknown) => { inserts.push(row); return { error: null }; },
      };
    },
    rpc: async () => ({ data: true, error: null }),
  };
  return { admin: admin as never, inserts };
}
const dados = { nome: "Nubank", limite: "5.000,00", diaFechamento: 25, diaVencimento: 5 };
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";

describe("Cadastro de cartão: vínculo determinístico", () => {
  it("linha revogada antiga sem 55 + linha ativa com 55 do mesmo usuário → cria", async () => {
    const { admin, inserts } = fakeAdmin([
      { telefone: "11999990000", user_id: A, ativo: false, opt_in_em: "x", revogado_em: "y" },
      { telefone: "5511999990000", user_id: A, ativo: true, opt_in_em: "x", revogado_em: null },
    ]);
    const r = await criarCartaoViaWhatsApp({ userId: A, telefone: "5511999990000", requestKey: "k1", dados }, admin);
    expect(r.status).toBe("criado");
    expect(inserts.length).toBe(1);
  });
  it("número ativo também ligado a outro usuário → sem_vinculo, nada gravado", async () => {
    const { admin, inserts } = fakeAdmin([
      { telefone: "11999990000", user_id: B, ativo: true, opt_in_em: "x", revogado_em: null },
      { telefone: "5511999990000", user_id: A, ativo: true, opt_in_em: "x", revogado_em: null },
    ]);
    const r = await criarCartaoViaWhatsApp({ userId: A, telefone: "5511999990000", requestKey: "k2", dados }, admin);
    expect(r.status).toBe("sem_vinculo");
    expect(inserts.length).toBe(0);
  });
  it("sem consentimento → sem_vinculo", async () => {
    const { admin, inserts } = fakeAdmin([{ telefone: "5511999990000", user_id: A, ativo: true, opt_in_em: null, revogado_em: null }]);
    const r = await criarCartaoViaWhatsApp({ userId: A, telefone: "5511999990000", requestKey: "k3", dados }, admin);
    expect(r.status).toBe("sem_vinculo");
    expect(inserts.length).toBe(0);
  });
});
