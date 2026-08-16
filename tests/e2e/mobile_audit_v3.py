import asyncio
import os
import json
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path("/tmp/browser/bens_v3_audit/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        # Mobile viewport for validation
        context = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await context.new_page()

        # Auth
        auth_status = os.environ.get("LOVABLE_BROWSER_AUTH_STATUS")
        if auth_status == "injected":
            storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
            session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
            cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
            if cookies_json:
                cookies = json.loads(cookies_json)
                for c in cookies: c["url"] = "http://localhost:8080"
                await context.add_cookies(cookies)
            await page.goto("http://localhost:8080")
            if storage_key and session_json:
                await page.evaluate(f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})")

        # Go directly to /bens
        await page.goto("http://localhost:8080/bens", wait_until="networkidle")
        
        # Check if we are stuck on onboarding and try to skip
        if "onboarding" in page.url:
            print("Onboarding detected, trying to bypass...")
            await page.evaluate("window.localStorage.setItem('user_onboarding', 'true')")
            await page.goto("http://localhost:8080/bens", wait_until="networkidle")

        await page.screenshot(path=str(SCREENSHOTS / "mobile_bens_list.png"))

        # Try to find or create a bem
        has_bens = await page.locator("a[href^='/bens/']").count() > 0
        if not has_bens:
            print("Creating test bem...")
            await page.get_by_role("button", name="Novo Bem").click()
            await page.fill("input[placeholder*='Ex: Minha Casa']", "Apartamento Mobile Audit")
            await page.get_by_role("button", name="Salvar").click()
            await page.wait_for_load_state("networkidle")
        
        # Enter details
        await page.locator("a[href^='/bens/']").first.click()
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SCREENSHOTS / "mobile_detalhe.png"))

        # Check for Simulator section
        # We might need to scroll or check if it's visible
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.screenshot(path=str(SCREENSHOTS / "mobile_bottom.png"))
        
        # If no financing, add one to enable simulator
        if await page.get_by_text("Dados insuficientes").is_visible() or await page.get_by_role("button", name="Salvar Financiamento").is_visible():
            print("Adding financing to enable simulation...")
            await page.fill("input[name*='valor_financiado']", "30000000") # 300k
            await page.fill("input[name*='prazo_meses']", "360")
            await page.fill("input[name*='taxa_juros_anual']", "10")
            # Select system if visible
            try:
                await page.get_by_role("combobox").first.click()
                await page.get_by_text("SAC", exact=True).click()
            except: pass
            
            await page.get_by_role("button", name="Salvar Financiamento").click()
            await page.wait_for_timeout(2000)

        # Trigger simulation
        sim_btn = page.get_by_role("button", name="Simular Amortização")
        if await sim_btn.is_visible():
            await sim_btn.click()
            await page.wait_for_timeout(1000)
            await page.screenshot(path=str(SCREENSHOTS / "mobile_simulador.png"))
            
            # Input extra value
            await page.fill("input[placeholder='R$ 0,00']", "1000000") # 10k
            await page.wait_for_timeout(1000)
            await page.screenshot(path=str(SCREENSHOTS / "mobile_simulacao_result.png"))
            
            # Check Economy Card
            eco = page.get_by_text("Economia de Juros")
            if await eco.is_visible():
                print("Economy card visible on mobile")
            
        await browser.close()

asyncio.run(main())
