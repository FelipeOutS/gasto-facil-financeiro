/**
 * WA-C11 FASE 3B.2.D — Section 0: prova de mutex entre o caminho
 * automático (`persistir`) e o fallback manual (`persistirManual`)
 * do fluxo de boleto.
 *
 * Este teste é PURAMENTE ESTRUTURAL — não chama Supabase, Graph API,
 * OCR ou HTTP externo. Ele valida:
 *
 *  (a) type guards mutuamente exclusivos: um objeto sessão tem UM `kind`;
 *      `isBoletoSession`, `isBoletoSelecaoSession` e `isBoletoManualSession`
 *      são disjuntos para qualquer valor de `kind`;
 *  (b) `isAnyBoletoSession` corresponde exatamente à união dos três guards;
 *  (c) o campo `kind` do TypeScript é discriminante: `BoletoSession`,
 *      `BoletoSelecaoSession` e `BoletoManualSession` têm valores literais
 *      distintos ("boleto", "boleto_selecao", "boleto_manual");
 *
 * Combinado com o roteamento por `session.kind` em `processarBoleto`
 * (dispatch nas linhas ~360-377 do módulo) e com a chave única de sessão
 * por `telefone × external_id`, isto prova que um evento de mensagem
 * WhatsApp atinge NO MÁXIMO UM dos dois `persistir*`. Portanto, os
 * discriminadores atuais de quota (`bill_create_boleto:<fingerprint>` para
 * o caminho auto e `bill_create_boleto:<sessaoId>` para o manual) NUNCA
 * podem ser consumidos pela mesma mensagem — não há bitributação.
 */
import { describe, it, expect } from "bun:test";
import {
  isBoletoSession,
  isBoletoSelecaoSession,
  isBoletoManualSession,
  isAnyBoletoSession,
  type BoletoSession,
  type BoletoSelecaoSession,
  type BoletoManualSession,
} from "@/server/whatsapp-boleto-intents.server";

const AUTO: BoletoSession = {
  kind: "boleto",
  fingerprint: "fp-auto-1",
  tipo: "cobranca",
  valorCentavos: 12345,
  vencimentoISO: "2026-08-01",
  identificacao: "Internet",
  mascara: "23791.11111 11111.111111 11111.111111 1 12340000012345",
  codigoBarras: "23791111111111111111111111111112340000012345",
};

const SEL: BoletoSelecaoSession = {
  kind: "boleto_selecao",
  origem: "imagem",
  candidatos: [
    {
      fingerprint: "fp-sel-1",
      mascara: "***",
      codigoBarras: "23791111111111111111111111111112340000067890",
      tipo: "cobranca",
      valorCentavos: 6789,
      vencimentoISO: "2026-09-10",
    },
  ],
  identificacaoSugerida: null,
};

const MANUAL: BoletoManualSession = {
  kind: "boleto_manual",
  origem: "imagem",
  valorCentavos: 4200,
  vencimentoISO: "2026-08-15",
  identificacao: null,
};

describe("WA-C11 3B.2.D Section 0 — mutex boleto auto × manual", () => {
  it("type guards são disjuntos: kind='boleto' só passa em isBoletoSession", () => {
    expect(isBoletoSession(AUTO)).toBe(true);
    expect(isBoletoSelecaoSession(AUTO)).toBe(false);
    expect(isBoletoManualSession(AUTO)).toBe(false);
  });

  it("type guards são disjuntos: kind='boleto_selecao' só passa em isBoletoSelecaoSession", () => {
    expect(isBoletoSession(SEL)).toBe(false);
    expect(isBoletoSelecaoSession(SEL)).toBe(true);
    expect(isBoletoManualSession(SEL)).toBe(false);
  });

  it("type guards são disjuntos: kind='boleto_manual' só passa em isBoletoManualSession", () => {
    expect(isBoletoSession(MANUAL)).toBe(false);
    expect(isBoletoSelecaoSession(MANUAL)).toBe(false);
    expect(isBoletoManualSession(MANUAL)).toBe(true);
  });

  it("isAnyBoletoSession = união dos três guards, sem sobreposição", () => {
    for (const s of [AUTO, SEL, MANUAL]) {
      const matches = [
        isBoletoSession(s),
        isBoletoSelecaoSession(s),
        isBoletoManualSession(s),
      ].filter(Boolean).length;
      expect(matches).toBe(1);
      expect(isAnyBoletoSession(s)).toBe(true);
    }
  });

  it("kind não-boleto: nenhum guard aceita", () => {
    const outros: unknown[] = [
      null,
      undefined,
      {},
      { kind: "gasto" },
      { kind: "conta" },
      { kind: "pix" },
      { kind: "" },
      "string",
      42,
    ];
    for (const s of outros) {
      expect(isBoletoSession(s)).toBe(false);
      expect(isBoletoSelecaoSession(s)).toBe(false);
      expect(isBoletoManualSession(s)).toBe(false);
      expect(isAnyBoletoSession(s)).toBe(false);
    }
  });

  it("discriminadores de kind são strings literais distintas", () => {
    const kinds = new Set([AUTO.kind, SEL.kind, MANUAL.kind]);
    expect(kinds.size).toBe(3);
    expect(kinds.has("boleto")).toBe(true);
    expect(kinds.has("boleto_selecao")).toBe(true);
    expect(kinds.has("boleto_manual")).toBe(true);
  });
});
