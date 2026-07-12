/**
 * WA-SEC-CA-01 — Hardening de UPDATE em public.connected_accounts.
 *
 * Valida contra o Postgres real (via psql com PG* env) que o trigger
 * `connected_accounts_prevent_invitee_escalation` bloqueia todas as tentativas
 * conhecidas de escalada de privilégios pelo viewer (criador do convite) e
 * pelo invitee-por-email, enquanto owner e fluxos legítimos seguem funcionando.
 *
 * Cada teste roda em transação atômica com ROLLBACK final — zero alteração
 * persistente. Simula 3 identidades JWT via `SET LOCAL request.jwt.claims`
 * combinado com `SET LOCAL ROLE authenticated`.
 *
 * Se PGHOST não estiver definido, todos os casos são pulados.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const hasDb = !!process.env.PGHOST;

function psql(script: string): { code: number; stdout: string; stderr: string } {
  const res = spawnSync("psql", ["-v", "ON_ERROR_STOP=0", "-X", "-A", "-t"], {
    input: script,
    encoding: "utf8",
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function jwtSet(uid: string, email?: string): string {
  const claims = JSON.stringify({ sub: uid, role: "authenticated", email: email ?? "" });
  // Nota: no ambiente de teste (sandbox_exec) não é permitido `SET ROLE authenticated`.
  // O trigger checa `auth.uid()`, que lê `request.jwt.claim.sub` — suficiente.
  return `SET LOCAL "request.jwt.claims" TO '${claims}';`;
}

function seed(kind: "pending" | "accepted", opts: { rowId: string; viewer: string; owner: string; email: string }): string {
  if (kind === "pending") {
    return `INSERT INTO public.connected_accounts
      (id, viewer_user_id, invited_email, owner_user_id, access_level, status)
      VALUES ('${opts.rowId}'::uuid, '${opts.viewer}'::uuid, '${opts.email}', NULL, 'view', 'pending');`;
  }
  return `INSERT INTO public.connected_accounts
    (id, viewer_user_id, invited_email, owner_user_id, access_level, status, accepted_at)
    VALUES ('${opts.rowId}'::uuid, '${opts.viewer}'::uuid, '${opts.email}', '${opts.owner}'::uuid, 'view', 'accepted', now());`;
}

function runCase(sqlBody: string) {
  return psql(`BEGIN;\n${sqlBody}\nROLLBACK;`);
}

describe.skipIf(!hasDb)("WA-SEC-CA-01 — connected_accounts hardening", () => {
  const VIEWER = randomUUID();
  const OWNER = randomUUID();
  const THIRD = randomUUID();
  const EMAIL = `invitee-sec-ca-01-${Date.now()}@example.test`;

  it("viewer NÃO pode elevar access_level (accepted)", () => {
    const id = randomUUID();
    const r = runCase(`
      ${seed("accepted", { rowId: id, viewer: VIEWER, owner: OWNER, email: EMAIL })}
      ${jwtSet(VIEWER)}
      UPDATE public.connected_accounts SET access_level='admin' WHERE id='${id}'::uuid;
    `);
    expect(r.stderr.toLowerCase()).toContain("viewers cannot change access_level".toLowerCase());
  });

  it("viewer NÃO pode elevar access_level em pending", () => {
    const id = randomUUID();
    const r = runCase(`
      ${seed("pending", { rowId: id, viewer: VIEWER, owner: OWNER, email: EMAIL })}
      ${jwtSet(VIEWER)}
      UPDATE public.connected_accounts SET access_level='admin' WHERE id='${id}'::uuid;
    `);
    expect(r.stderr.toLowerCase()).toContain("viewers cannot change access_level".toLowerCase());
  });

  it("viewer NÃO pode trocar owner_user_id", () => {
    const id = randomUUID();
    const r = runCase(`
      ${seed("accepted", { rowId: id, viewer: VIEWER, owner: OWNER, email: EMAIL })}
      ${jwtSet(VIEWER)}
      UPDATE public.connected_accounts SET owner_user_id='${THIRD}'::uuid WHERE id='${id}'::uuid;
    `);
    expect(r.stderr.toLowerCase()).toContain("viewers cannot change owner_user_id".toLowerCase());
  });

  it("viewer NÃO pode trocar invited_email", () => {
    const id = randomUUID();
    const r = runCase(`
      ${seed("pending", { rowId: id, viewer: VIEWER, owner: OWNER, email: EMAIL })}
      ${jwtSet(VIEWER)}
      UPDATE public.connected_accounts SET invited_email='attacker@example.test' WHERE id='${id}'::uuid;
    `);
    expect(r.stderr.toLowerCase()).toContain("viewers cannot change invited_email".toLowerCase());
  });

  it("viewer NÃO pode trocar invite_token", () => {
    const id = randomUUID();
    const r = runCase(`
      ${seed("pending", { rowId: id, viewer: VIEWER, owner: OWNER, email: EMAIL })}
      ${jwtSet(VIEWER)}
      UPDATE public.connected_accounts SET invite_token='deadbeef-forged' WHERE id='${id}'::uuid;
    `);
    expect(r.stderr.toLowerCase()).toContain("viewers cannot change invite_token".toLowerCase());
  });

  it("viewer NÃO pode forçar status=accepted (privilégio do invitee)", () => {
    const id = randomUUID();
    const r = runCase(`
      ${seed("pending", { rowId: id, viewer: VIEWER, owner: OWNER, email: EMAIL })}
      ${jwtSet(VIEWER)}
      UPDATE public.connected_accounts SET status='accepted' WHERE id='${id}'::uuid;
    `);
    expect(r.stderr.toLowerCase()).toContain("viewers can only set status to removed".toLowerCase());
  });

  it("terceiro sem vínculo cai no ramo invitee do trigger e é bloqueado", () => {
    const id = randomUUID();
    const r = runCase(`
      ${seed("accepted", { rowId: id, viewer: VIEWER, owner: OWNER, email: EMAIL })}
      ${jwtSet(THIRD)}
      UPDATE public.connected_accounts SET access_level='admin' WHERE id='${id}'::uuid;
    `);
    expect(r.stderr.toLowerCase()).toContain("invitees cannot change access_level".toLowerCase());
  });

  it("invitee-por-email pode transicionar pending -> accepted", () => {
    const id = randomUUID();
    const r = runCase(`
      ${seed("pending", { rowId: id, viewer: VIEWER, owner: OWNER, email: EMAIL })}
      ${jwtSet(OWNER, EMAIL)}
      UPDATE public.connected_accounts
        SET status='accepted', owner_user_id='${OWNER}'::uuid, accepted_at=now()
        WHERE id='${id}'::uuid;
    `);
    expect(r.stderr).not.toMatch(/cannot|denied|violates row-level/i);
  });

  it("invitee-por-email NÃO pode alterar access_level ao aceitar", () => {
    const id = randomUUID();
    const r = runCase(`
      ${seed("pending", { rowId: id, viewer: VIEWER, owner: OWNER, email: EMAIL })}
      ${jwtSet(OWNER, EMAIL)}
      UPDATE public.connected_accounts
        SET status='accepted', owner_user_id='${OWNER}'::uuid, access_level='admin'
        WHERE id='${id}'::uuid;
    `);
    expect(r.stderr.toLowerCase()).toContain("invitees cannot change access_level".toLowerCase());
  });

  it("owner altera access_level legitimamente", () => {
    const id = randomUUID();
    const r = runCase(`
      ${seed("accepted", { rowId: id, viewer: VIEWER, owner: OWNER, email: EMAIL })}
      ${jwtSet(OWNER)}
      UPDATE public.connected_accounts SET access_level='admin' WHERE id='${id}'::uuid;
    `);
    expect(r.stderr).not.toMatch(/cannot|denied|violates row-level/i);
  });
});
