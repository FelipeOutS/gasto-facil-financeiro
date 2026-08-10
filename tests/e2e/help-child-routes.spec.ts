import { expect, test, type Page } from "@playwright/test";
import { readE2EEnv } from "./helpers/env";

const envResult = readE2EEnv();
const managedStorageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const managedSession = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const hasManagedSession = !!(managedStorageKey && managedSession);

test.describe("Ajuda — child routes", () => {
  async function login(page: Page) {
    if (managedStorageKey && managedSession) {
      await page.goto("/");
      await page.evaluate(({ key, session }) => window.localStorage.setItem(key, session), {
        key: managedStorageKey,
        session: managedSession,
      });
      return;
    }

    if (!envResult.ok) return;
    const env = envResult.env;
    await page.goto("/login");
    await page.getByLabel(/e-?mail/i).fill(env.qaEmail);
    await page.getByLabel(/senha|password/i).fill(env.qaPassword);
    await page.getByRole("button", { name: /entrar|sign in|log in/i }).click();
    await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 15_000 });
  }

  test("child route renders child content instead of help hub", async ({ page }) => {
    test.skip(!hasManagedSession && !envResult.ok, "Sessão QA não disponível.");
    await login(page);

    const cases = [
      {
        path: "/app/ajustes/ajuda/suporte",
        heading: "Suporte",
        testId: "settings-help-support",
        content: "suporte@gastointeligente.com.br",
      },
      {
        path: "/app/ajustes/ajuda/termos",
        heading: /Termos de uso/i,
        testId: "settings-help-terms",
        content: "1. Sobre o serviço",
      },
      {
        path: "/app/ajustes/ajuda/privacidade",
        heading: /Política de privacidade/i,
        testId: "settings-help-privacy",
        content: "1. Quais dados coletamos",
      },
    ] as const;

    for (const route of cases) {
      await page.goto(route.path);
      await expect(page).toHaveURL(new RegExp(`${route.path}$`));
      await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
      await expect(page.getByTestId(route.testId)).toContainText(route.content);
      await expect(page.getByTestId("settings-help-hub")).toHaveCount(0);

      await page.reload();
      await expect(page).toHaveURL(new RegExp(`${route.path}$`));
      await expect(page.getByTestId(route.testId)).toBeVisible();
      await expect(page.getByTestId("settings-help-hub")).toHaveCount(0);
    }
  });
});
