"""Read-only browser check. No sign-in, Meta calls or financial writes. Run with python3."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
    target=Path('/tmp/browser/reorganization-structural');target.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        context=await browser.new_context(viewport={"width":1280,"height":1800})
        page=await context.new_page()
        await page.goto('http://localhost:8080',wait_until='domcontentloaded')
        result=await page.evaluate("""async()=>{const {interpretReorganization}=await import('/src/lib/whatsapp-reorganizacao.ts');return interpretReorganization('GI, exclua todas as minhas despesas e receitas de todos os meses anteriores, mantenha os dados do mês atual e ajuste meu saldo do Nubank para R$ 5.000.','2026-11-03')}""")
        assert result['scope']['end']=='2026-11-01'
        assert result['income'] is None
        assert result['openingBalance']['kind']=='current_adjustment'
        assert result['openingBalance']['accountName']=='Nubank'
        assert result['openingBalance']['amountCents']==500000
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(target/'parser-preview.png'))
        print('PASS: real browser parser exact command; no writes; Android/audio not certified')
        await browser.close()
asyncio.run(main())