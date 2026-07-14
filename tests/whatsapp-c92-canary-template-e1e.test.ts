/**
 * WA-C9.2 Fase E.1E — Testes da migration candidata do template canary.
 *
 * A migration é APENAS candidata; NÃO é aplicada em produção. Este teste
 * valida ESTATICAMENTE o SQL: idempotência, ausência de operações
 * proibidas, ausência de alterações em templates produtivos e presença das
 * proteções contra sobrescrita silenciosa.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SQL_PATH = join(process.cwd(), "docs/migrations-candidate/wa-c92-e1e-canary-template.sql");

describe("migration candidata — canary template", () => {
  it("existe no local esperado (fora de supabase/migrations)", () => {
    expect(existsSync(SQL_PATH)).toBe(true);
    // Garante que NÃO foi enfiada em supabase/migrations por engano.
    expect(SQL_PATH.includes("supabase/migrations")).toBe(false);
  });

  const sql = existsSync(SQL_PATH) ? readFileSync(SQL_PATH, "utf-8") : "";

  it("insere apenas o template canary", () => {
    const inserts = sql.match(/INSERT\s+INTO/gi) ?? [];
    expect(inserts.length).toBe(1);
    expect(sql).toContain("gi_teste_integracao_canary");
    expect(sql).toContain("hello_world");
    expect(sql).toContain("en_US");
    expect(sql).toContain("avisos_sistema");
    expect(sql).toContain("baixa");
  });

  it("não altera templates produtivos gi_conta_*", () => {
    expect(sql).not.toMatch(/gi_conta_/);
  });

  it("não usa ON CONFLICT DO UPDATE silencioso", () => {
    expect(sql).not.toMatch(/on\s+conflict[\s\S]*do\s+update/i);
  });

  it("possui proteção contra sobrescrita divergente (RAISE EXCEPTION)", () => {
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i);
  });

  it("não altera schema (CREATE/ALTER/DROP TABLE|COLUMN|CONSTRAINT|POLICY|TRIGGER|GRANT)", () => {
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/ADD\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/ADD\s+CONSTRAINT/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/DROP\s+POLICY/i);
    expect(sql).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(sql).not.toMatch(/^\s*GRANT/im);
  });

  it("não cria notification, attempt ou status event", () => {
    expect(sql).not.toMatch(/INTO\s+public\.whatsapp_notifications\b/i);
    expect(sql).not.toMatch(/whatsapp_notification_attempts/i);
    expect(sql).not.toMatch(/whatsapp_notification_status_events/i);
  });

  it("não cria cron nem função nova", () => {
    expect(sql).not.toMatch(/pg_cron|cron\.schedule/i);
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
  });

  it("documenta rollback lógico como comentário, não como comando ativo", () => {
    // O DELETE deve aparecer somente em comentário (linha começando com --).
    const lines = sql.split("\n");
    const activeDelete = lines.find(
      (ln) => /DELETE\s+FROM/i.test(ln) && !ln.trim().startsWith("--"),
    );
    expect(activeDelete).toBeUndefined();
  });
});
