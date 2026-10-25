import { test, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
test("Agenda SQL: actual catalog constraints, disabled seeds, reapply preserves operator state", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    const c8 = readFileSync(
      "supabase/migrations/20260627235317_6156ded2-67ed-4a29-8d60-dadf90d7abaa.sql",
      "utf8",
    );
    const start = c8.indexOf("CREATE TABLE IF NOT EXISTS public.whatsapp_notification_templates");
    await db.exec(
      c8
        .slice(start, c8.indexOf("GRANT SELECT", start))
        .replace(
          "'ia_insights','mercado','avisos_sistema'",
          "'ia_insights','mercado','avisos_sistema','agenda'",
        ),
    );
    await db.exec(
      "INSERT INTO whatsapp_notification_templates(key,category) VALUES ('gi_conta_vencendo_hoje','contas_a_pagar'),('gi_conta_vencendo_amanha','contas_a_pagar'),('gi_conta_atrasada','contas_a_pagar');",
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/20260720020401_dce25c02-ee96-4a74-86f4-f39390268836.sql",
        "utf8",
      ),
    );
    const candidate = readFileSync(
      "docs/migrations-candidate/whatsapp-agenda-templates.sql",
      "utf8",
    );
    await db.exec(candidate);
    expect(
      (
        await db.query(
          "SELECT status,active,language,category FROM whatsapp_meta_templates WHERE internal_key LIKE 'gi_agenda_%'",
        )
      ).rows,
    ).toEqual([
      { status: "draft", active: false, language: "pt_BR", category: "UTILITY" },
      { status: "draft", active: false, language: "pt_BR", category: "UTILITY" },
    ]);
    await db.exec(
      "UPDATE whatsapp_meta_templates SET status='approved',provider_template_id='fixture',active=true WHERE internal_key='gi_agenda_lembrete'",
    );
    await db.exec(candidate);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM whatsapp_meta_templates WHERE internal_key LIKE 'gi_agenda_%'",
        )
      ).rows[0],
    ).toEqual({ n: 2 });
    expect(
      (
        await db.query(
          "SELECT active FROM whatsapp_meta_templates WHERE internal_key='gi_agenda_lembrete'",
        )
      ).rows[0],
    ).toEqual({ active: true });
  } finally {
    await db.close();
  }
}, 15000);
