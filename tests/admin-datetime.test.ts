import { describe, it, expect } from "vitest";
import {
  formatAdminDate,
  formatAdminTime,
  formatAdminDateTime,
  adminDateTimeTooltip,
  compareCreatedAtDesc,
} from "@/lib/admin-datetime";

const FIXED = "2026-08-07T04:48:00.000Z";

describe("admin-datetime", () => {
  it("formata data + horário em pt-BR / America/Sao_Paulo", () => {
    expect(formatAdminDateTime(FIXED)).toBe("07/08/2026 às 01:48");
    expect(formatAdminDate(FIXED)).toBe("07/08/2026");
    expect(formatAdminTime(FIXED)).toBe("01:48");
  });

  it("não depende do timezone do processo/navegador", () => {
    const original = process.env.TZ;
    for (const tz of ["UTC", "America/New_York", "Europe/London", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      expect(formatAdminDateTime(FIXED)).toBe("07/08/2026 às 01:48");
    }
    process.env.TZ = original;
  });

  it("fallback seguro para nulo e inválido", () => {
    expect(formatAdminDateTime(null)).toBe("—");
    expect(formatAdminDateTime("não-é-data")).toBe("—");
    expect(formatAdminTime(null)).toBe("");
  });

  it("tooltip contém o timestamp ISO original", () => {
    const t = adminDateTimeTooltip(FIXED);
    expect(t).toContain("07/08/2026 às 01:48");
    expect(t).toContain("2026-08-07T04:48:00.000Z");
  });

  it("ordena pelo timestamp real, inclusive no mesmo dia", () => {
    const rows = [
      { id: "A", created_at: "2026-08-07T11:00:00.000Z" }, // 08:00
      { id: "B", created_at: "2026-08-07T17:30:00.000Z" }, // 14:30
      { id: "C", created_at: "2026-08-07T13:15:00.000Z" }, // 10:15
    ];
    expect([...rows].sort(compareCreatedAtDesc).map((r) => r.id)).toEqual(["B", "C", "A"]);
  });

  it("timestamps nulos vão para o fim", () => {
    const rows = [
      { id: "X", created_at: null },
      { id: "Y", created_at: FIXED },
    ];
    expect([...rows].sort(compareCreatedAtDesc).map((r) => r.id)).toEqual(["Y", "X"]);
  });
});
