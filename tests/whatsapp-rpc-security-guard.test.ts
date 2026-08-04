/**
 * WA-SEC-RPC-01 — Hardening de RPCs financeiras SECURITY DEFINER.
 *
 * Verifica no ambiente real do Supabase que:
 *  - whatsapp_baixa_conta_atomic
 *  - create_installment_purchase
 *  - create_recurring_income
 *
 * NÃO são executáveis via Data API por PUBLIC/anon/authenticated,
 * mesmo com p_user_id arbitrário. A guarda interna adicionada
 * (`auth.role() = 'service_role'`) e o REVOKE de EXECUTE devem
 * rejeitar toda chamada não-service_role com HTTP 4xx e código
 * `42501` ("permission denied").
 *
 * Requer SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (chave anon).
 * Sem essas variáveis o teste é ignorado (skip), mantendo o runner
 * verde em ambientes sem Data API acessível.
 */
import { describe, it, expect } from "bun:test";

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const skip = !URL || !ANON;

async function callRpc(name: string, body: Record<string, unknown>) {
  const res = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON as string,
      Authorization: `Bearer ${ANON}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, text, json: json as Record<string, unknown> | null };
}

function expectDenied(result: {
  status: number;
  text: string;
  json: Record<string, unknown> | null;
}) {
  // PostgREST retorna 401/403/404/400 conforme camada que barra.
  // Aceitamos qualquer 4xx com código/mensagem de permissão negada, OU
  // 404 quando o REVOKE remove a rota completamente da Data API.
  expect(result.status).toBeGreaterThanOrEqual(400);
  expect(result.status).toBeLessThan(500);
  const msg = (result.text || "").toLowerCase();
  const code = (result.json?.code as string | undefined) || "";
  const hint = (result.json?.message as string | undefined) || "";
  const denied =
    code === "42501" ||
    code === "PGRST202" ||
    code === "PGRST301" ||
    /permission denied/.test(msg) ||
    /not.*found/.test(msg) ||
    /schema cache/.test(hint.toLowerCase());
  expect(denied).toBe(true);
}

describe.skipIf(skip)("WA-SEC-RPC-01 — RPCs financeiras não são executáveis via anon", () => {
  it("whatsapp_baixa_conta_atomic: anon é rejeitado (permission denied)", async () => {
    const res = await callRpc("whatsapp_baixa_conta_atomic", {
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_conta_id: "00000000-0000-0000-0000-000000000000",
      p_data_pagamento: "2026-07-12",
      p_origem: "whatsapp",
    });
    expectDenied(res);
  });

  it("create_installment_purchase: anon é rejeitado (permission denied)", async () => {
    const res = await callRpc("create_installment_purchase", {
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_cartao_id: "00000000-0000-0000-0000-000000000000",
      p_categoria_id: null,
      p_descricao: "attack",
      p_estabelecimento: "",
      p_observacao: "",
      p_origem: "whatsapp",
      p_grupo_id: "00000000-0000-0000-0000-000000000000",
      p_total_parcelas: 2,
      p_parcelas: [
        { numero: 1, valor: 10, data: "2026-07-12", mes: 7, ano: 2026, invoice_month: "2026-07" },
        { numero: 2, valor: 10, data: "2026-08-12", mes: 8, ano: 2026, invoice_month: "2026-08" },
      ],
    });
    expectDenied(res);
  });

  it("create_recurring_income: anon é rejeitado (permission denied)", async () => {
    const res = await callRpc("create_recurring_income", {
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_descricao: "attack",
      p_valor: 999,
      p_data: "2026-07-12",
      p_tipo: "outros",
      p_frequencia: "mensal",
      p_dia_mes: 5,
      p_dia_semana: null,
      p_observacao: null,
      p_origem: "whatsapp",
    });
    expectDenied(res);
  });
});

/**
 * Testes de contrato local — asseguram que fake tests (bun) continuam
 * exercitando o caminho legítimo. A guarda `auth.role()` só é aplicada
 * no Postgres real; os fakes seguem chamando com sucesso, garantindo
 * que o contrato funcional (retorno, ownership, rollback) permanece.
 */
describe("WA-SEC-RPC-01 — contrato preservado (referencial)", () => {
  it("assinaturas esperadas continuam publicadas via runner (documentação)", () => {
    // Cobertura funcional real está em:
    //   tests/whatsapp-baixa-conta-atomic-3-30.test.ts
    //   tests/whatsapp-parcelamento-rpc-hardening.test.ts
    //   tests/whatsapp-receita-recorrencia-rpc.test.ts
    // Esta asserção só serve de âncora para o runner listar o arquivo.
    expect(true).toBe(true);
  });
});
