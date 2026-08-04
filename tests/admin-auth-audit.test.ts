import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hasAdminMasterRole,
  isAdminMasterEmail,
  assertAdminMaster,
  __resetAdminMasterCacheForTests,
} from "../src/server/admin-master.server";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";

// Mock do supabaseAdmin via vitest
vi.mock("../src/integrations/supabase/client.server", () => {
  return {
    supabaseAdmin: {
      from: vi.fn(),
    },
  };
});

describe("Admin Master Authorization Audit", () => {
  const adminId = "11111111-1111-4111-8111-111111111111";
  const commonId = "22222222-2222-4222-8222-222222222222";
  const adminEmail = "admin@gastointeligente.com.br";
  const commonEmail = "user@example.com";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_MASTER_EMAILS = adminEmail;
    __resetAdminMasterCacheForTests();
  });

  const setupDbResponse = (data: any, error: any = null) => {
    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === "user_roles") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data, error }),
              }),
            }),
          }),
        };
      }
      return {};
    });
  };

  describe("hasAdminMasterRole", () => {
    it("should return true if user has owner role in database", async () => {
      setupDbResponse({ role: "owner" });
      const result = await hasAdminMasterRole(adminId);
      expect(result).toBe(true);
    });

    it("should return false if user does not have owner role", async () => {
      setupDbResponse(null);
      const result = await hasAdminMasterRole(commonId);
      expect(result).toBe(false);
    });

    it("should return false on database error (fail-closed)", async () => {
      setupDbResponse(null, { message: "DB Error" });
      const result = await hasAdminMasterRole(adminId);
      expect(result).toBe(false);
    });
  });

  describe("isAdminMasterEmail", () => {
    it("should identify admin emails from env", () => {
      expect(isAdminMasterEmail(adminEmail)).toBe(true);
      expect(isAdminMasterEmail(commonEmail)).toBe(false);
    });
  });

  describe("assertAdminMaster", () => {
    it("should authorize if user has owner role (ignoring email for decision)", async () => {
      setupDbResponse({ role: "owner" });
      // Simplesmente aguarda a resolução sem erro
      await assertAdminMaster({ id: adminId, email: commonEmail });
    });

    it("should deny if user has admin email but lacks owner role", async () => {
      setupDbResponse(null);
      await expect(assertAdminMaster({ id: commonId, email: adminEmail })).rejects.toThrow(
        "Forbidden: Admin Master role required",
      );
    });

    it("should deny common users", async () => {
      setupDbResponse(null);
      await expect(assertAdminMaster({ id: commonId, email: commonEmail })).rejects.toThrow(
        "Forbidden: Admin Master role required",
      );
    });

    it("should deny if session is missing", async () => {
      await expect(assertAdminMaster(null)).rejects.toThrow("Unauthorized: No session");
    });
  });
});
