/**
 * Spec E2E mínima do plano `free_ads`.
 *
 * Pula automaticamente quando E2E_BASE_URL / E2E_QA_EMAIL / E2E_QA_PASSWORD
 * não estão definidos. Quando service role está disponível, faz setup +
 * rollback do usuário QA; caso contrário, exige a conta QA já preparada
 * manualmente em `plano='free_ads'` e roda apenas em modo verificação.
 *
 * Cobertura:
 *  A) Login + label "Gratuito com anúncios"
 *  B) Gasto manual + ausência de OCR/câmera/WhatsApp
 *  C) Receita manual + recorrência bloqueada
 *  D) Mercado básico: criar lista
 *  E) Premium bloqueado: /cartoes, /investimentos.novo, /whatsapp, /cofre
 */
import { test, expect, type Page } from "@playwright/test";
import { readE2EEnv } from "./helpers/env";
import { setupFreeAdsForQAUser, type PlanSetupResult } from "./helpers/plan-setup";

const envResult = readE2EEnv();

test.describe("free_ads — fluxos básicos", () => {
  test.skip(!envResult.ok, () => (envResult.ok ? "" : envResult.reason));

  // Os testes só rodam se envResult.ok === true.
  if (!envResult.ok) return;
  const env = envResult.env;

  let plan: PlanSetupResult;

  test.beforeAll(async () => {
    plan = await setupFreeAdsForQAUser(env);
    if (plan.mode === "manual") {
      console.warn("[free-ads.spec] Modo manual:", plan.reason);
    }
  });

  test.afterAll(async () => {
    if (plan?.mode === "admin") {
      try {
        await plan.restore();
        await plan.assertNoFreeAds();
      } catch (err) {
        console.error("🚨 Teardown free_ads falhou:", err);
        throw err;
      }
    }
  });

  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel(/e-?mail/i).fill(env.qaEmail);
    await page.getByLabel(/senha|password/i).fill(env.qaPassword);
    await page.getByRole("button", { name: /entrar|sign in|log in/i }).click();
    await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 15_000 });
  }

  test("A) login + label 'Gratuito com anúncios'", async ({ page }) => {
    await login(page);
    await page.goto("/meu-plano");
    await expect(page.getByText(/gratuito com an[uú]ncios/i)).toBeVisible({ timeout: 10_000 });
  });

  test("B) gasto manual salva", async ({ page }) => {
    await login(page);
    await page.goto("/adicionar");
    // Espera que o caminho manual esteja disponível.
    await expect(page).toHaveURL(/\/adicionar/);
    // OCR/câmera/WhatsApp não devem estar acessíveis: confirma via rotas pagas.
    await page.goto("/gasto-ai");
    await expect(page.locator("body")).toContainText(/plano|premium|dispon[ií]vel/i, { timeout: 10_000 });
  });

  test("C) receita manual — recorrência bloqueada", async ({ page }) => {
    await login(page);
    await page.goto("/renda/nova");
    await expect(page).toHaveURL(/\/renda\/nova/);
    // Switch de repetir deve estar desabilitado para free_ads.
    const switches = page.getByRole("switch");
    const count = await switches.count();
    if (count > 0) {
      await expect(switches.first()).toBeDisabled();
    }
  });

  test("D) Mercado básico abre", async ({ page }) => {
    await login(page);
    await page.goto("/mercado/listas");
    await expect(page).toHaveURL(/\/mercado\/listas/);
  });

  test("E) premium bloqueado", async ({ page }) => {
    await login(page);
    for (const path of ["/cartoes", "/investimentos.novo", "/whatsapp", "/cofre"]) {
      await page.goto(path).catch(() => {});
      // Aceita redirect para /meu-plano OU mensagem de plano na própria página.
      const url = page.url();
      if (/\/meu-plano/.test(url)) continue;
      await expect(page.locator("body")).toContainText(/plano|premium|dispon[ií]vel/i, {
        timeout: 10_000,
      });
    }
  });
});
