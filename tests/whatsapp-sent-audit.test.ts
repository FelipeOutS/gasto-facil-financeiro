import { describe, it, expect } from "bun:test";
import {
  auditWhatsAppSentMessages,
  type SentAuditDatabase,
} from "../src/server/whatsapp-sent-audit.server";

function database(queue: number | null, events: number | null, error = false): SentAuditDatabase {
  return {
    from(table) {
      return {
        select(columns, options) {
          expect(columns).toBe("id");
          expect(options).toEqual({ count: "exact", head: true });
          return {
            async eq(column, value) {
              expect([column, value]).toEqual(
                table === "whatsapp_outbound_queue"
                  ? ["status", "sent"]
                  : ["usage_type", "outbound"],
              );
              return {
                count: table === "whatsapp_outbound_queue" ? queue : events,
                error: error ? { message: "database unavailable" } : null,
              };
            },
          };
        },
      };
    },
  };
}

describe("Auditoria de mensagens WhatsApp sem banco real", () => {
  it("confirma zero somente quando as duas consultas retornam zero", async () => {
    expect(await auditWhatsAppSentMessages(database(0, 0))).toEqual({
      queueSent: 0,
      usageOutbound: 0,
    });
  });
  it("preserva contagens não zero sem fingir que nada foi enviado", async () => {
    expect(await auditWhatsAppSentMessages(database(2, 3))).toEqual({
      queueSent: 2,
      usageOutbound: 3,
    });
  });
  it("falha se o banco recusar a consulta", async () => {
    await expect(auditWhatsAppSentMessages(database(null, null, true))).rejects.toThrow();
  });
  it("não transforma contagem indisponível em zero", async () => {
    await expect(auditWhatsAppSentMessages(database(0, null))).rejects.toThrow();
  });
});
