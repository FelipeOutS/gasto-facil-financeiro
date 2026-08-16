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
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        # 1. Login/Auth Setup
        # O usuário 'qa-freeads' já foi mencionado como tendo problemas de onboarding.
        # Vou tentar usar o token se injetado, senão tento navegar.
        auth_status = os.environ.get("LOVABLE_BROWSER_AUTH_STATUS")
        print(f"Auth status: {auth_status}")
        
        if auth_status == "injected":
            storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
            session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
            cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
            
            if cookies_json:
                cookies = json.loads(cookies_json)
                for c in cookies:
                    c["url"] = "http://localhost:8080"
                await context.add_cookies(cookies)
            
            await page.goto("http://localhost:8080")
            if storage_key and session_json:
                await page.evaluate(f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})")
        
        # Navega para a lista de bens
        await page.goto("http://localhost:8080/bens", wait_until="networkidle")
        await page.screenshot(path=str(SCREENSHOTS / "1_bens_list.png"))
        print(f"URL atual: {page.url}")

        # Se cair no onboarding, tentamos pular ou clicar em 'Próximo' se possível,
        # mas aqui focaremos em validar a UI do simulador se conseguirmos chegar lá.
        if "/onboarding" in page.url:
            print("Caiu no onboarding. Tentando prosseguir...")
            # Tentativa genérica de clicar em botões de 'Próximo' ou 'Continuar'
            for _ in range(5):
                btn = page.get_by_role("button", name=re.compile(r"Próximo|Continuar|Pular", re.I))
                if await btn.is_visible():
                    await btn.click()
                    await page.wait_for_timeout(1000)
                else:
                    break
            await page.goto("http://localhost:8080/bens", wait_until="networkidle")

        # 2. Criar um Bem e um Financiamento de teste se necessário
        # Para esta auditoria, vamos assumir que queremos ver o Simulador.
        # Procuramos um bem existente ou criamos um rápido.
        
        # Verifica se tem o botão de adicionar
        add_btn = page.get_by_role("button", name="Novo Bem")
        if await add_btn.is_visible():
            await add_btn.click()
            await page.fill("input[placeholder*='Ex: Minha Casa']", "Apartamento Auditoria V3")
            await page.get_by_role("button", name="Salvar").click()
            await page.wait_for_load_state("networkidle")
            print("Bem de teste criado.")

        # Entrar no detalhe do bem (primeiro da lista)
        await page.locator("a[href^='/bens/']").first.click()
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SCREENSHOTS / "2_bem_detalhe.png"))
        
        # 3. Adicionar Financiamento SAC
        # Procura aba de Financiamento ou botão de adicionar
        tabs = page.get_by_role("tab")
        if await tabs.filter(has_text="Financiamento").is_visible():
            await tabs.filter(has_text="Financiamento").click()
        
        # Preencher formulário de financiamento
        await page.fill("input[name*='valor_financiado']", "300.000,00")
        await page.fill("input[name*='prazo_meses']", "360")
        await page.fill("input[name*='taxa_juros_anual']", "10")
        # Selecionar SAC (geralmente default ou select)
        # await page.select_option("select", "sac")
        
        await page.get_by_role("button", name="Salvar Financiamento").click()
        await page.wait_for_timeout(2000)
        await page.screenshot(path=str(SCREENSHOTS / "3_financiamento_salvo.png"))

        # 4. Abrir Simulador
        sim_btn = page.get_by_role("button", name="Simular Amortização")
        if await sim_btn.is_visible():
            await sim_btn.click()
            await page.wait_for_timeout(1000)
            await page.screenshot(path=str(SCREENSHOTS / "4_simulador_aberto.png"))
            
            # Testar Amortização Extra
            await page.fill("input[placeholder='0,00']", "10.000,00")
            await page.wait_for_timeout(500)
            await page.screenshot(path=str(SCREENSHOTS / "5_simulacao_10k.png"))
            
            # Alternar entre Reduzir Prazo e Parcela
            await page.get_by_label("Reduzir Parcela").click()
            await page.wait_for_timeout(500)
            await page.screenshot(path=str(SCREENSHOTS / "6_reduzir_parcela.png"))
            
            # Verificar Cronograma
            cron_btn = page.get_by_role("button", name="Ver cronograma completo")
            if await cron_btn.is_visible():
                await cron_btn.click()
                await page.wait_for_timeout(500)
                await page.screenshot(path=str(SCREENSHOTS / "7_cronograma.png"))

        await browser.close()

import re
asyncio.run(main())
