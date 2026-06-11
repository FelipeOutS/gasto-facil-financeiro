import { defineConfig, devices } from "@playwright/test";

/**
 * Fase 1E-B2G — Configuração Playwright para QA do plano `free_ads`.
 *
 * baseURL e credenciais vêm de variáveis de ambiente. Quando ausentes, as
 * specs marcam o caso como `test.skip` em vez de falhar de forma confusa
 * (ver tests/e2e/helpers/env.ts).
 *
 * Nada aqui altera build, dev server, RLS, checkout ou Mercado Pago.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
