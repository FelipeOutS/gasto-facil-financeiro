/**
 * WA-3.27 — Idempotência de reentrega de webhook.
 *
 * Bug capturado no smoke:
 *   Reentregar o mesmo `wamid` do "sim" corretamente bloqueava o
 *   segundo gasto (idempotência financeira), mas ainda dispatchava
 *   "Mensagem já processada anteriormente." para o WhatsApp,
 *   poluindo o chat do usuário.
 *
 * Contrato pós-fix (route `public.whatsapp.expense.ts`):
 *   - quando `processarMensagemWhatsApp` retorna `status === "duplicada"`,
 *     o handler NÃO deve chamar `sendWhatsAppReply` nem
 *     `sendWhatsAppInteractiveCtaUrl` para aquela mensagem;
 *   - o log em `webhook_logs` deve ser marcado como `ignored` quando
 *     todas as mensagens do lote são duplicatas (nenhum efeito colateral
 *     novo), em vez de `processed`;
 *   - a rota continua respondendo HTTP 200 (nada muda para Meta);
 *   - nenhum novo gasto/sessão/claim é criado (garantido em outras
 *     camadas — cobertura aqui é do dispatch de saída).
 *
 * Estratégia: como o dispatch e o label do log vivem em texto da rota
 * (não em módulos pure-JS facilmente instanciáveis num teste unitário
 * sem tocar Meta Graph API), verificamos o contrato via *asserções
 * estruturais* no arquivo-fonte. Isso pega regressões óbvias (alguém
 * remove o guard e volta a spamar o chat).
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE = readFileSync(
  resolve(import.meta.dir, "../src/routes/api/public.whatsapp.expense.ts"),
  "utf8",
);

describe("WA-3.27 webhook replay é silencioso", () => {
  it("dispatch de saída é gated por status !== 'duplicada'", () => {
    // O guard exato precisa estar presente. Sem ele o replay volta a
    // mandar "Mensagem já processada anteriormente." para o usuário.
    const guardPattern =
      /out\.resposta\s*&&\s*msg\.telefone\s*&&\s*out\.status\s*!==\s*["']duplicada["']/;
    expect(ROUTE).toMatch(guardPattern);
  });

  it("webhook_logs.status vira 'ignored' quando todo o lote é duplicata", () => {
    // Precisamos rotular o log como ignored/duplicate — não processed —
    // para que auditorias externas consigam distinguir uma reentrega
    // silenciosa de um processamento com efeito colateral.
    expect(ROUTE).toMatch(
      /allDuplicates[\s\S]{0,120}results\.every\([^)]*status\s*===\s*["']duplicada["']/,
    );
    expect(ROUTE).toMatch(
      /status:\s*allDuplicates\s*\?\s*["']ignored["']\s*:\s*["']processed["']/,
    );
  });

  it("nenhum caminho de replay chama sendWhatsAppReply sem guard", () => {
    // Sanity: apenas 1 ocorrência de sendWhatsAppReply na branch de
    // `out.resposta` (a coberta pelo guard). Se aparecer outra chamada
    // solta na mesma pipeline, o guard deixa de proteger.
    const bloco =
      ROUTE.split("const out = await processarMensagemWhatsApp(runMsg);")[1] ?? "";
    const fim = bloco.indexOf("} catch (e) {");
    const trecho = bloco.slice(0, fim > 0 ? fim : bloco.length);
    // Guard precisa envolver ambos os dispatchers:
    expect(trecho).toContain('out.status !== "duplicada"');
    // E não pode haver um segundo sendWhatsAppReply fora do if.
    const matches = trecho.match(/sendWhatsAppReply\(/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
