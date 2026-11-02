import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const css = await readFile('src/premium.css', 'utf8');
const browser = await chromium.launch();
try {
  for (const width of [320, 390, 448, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}main{width:100%;padding:24px}section{width:100%;display:flex;flex-direction:column;padding:16px}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.summary span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}nav{position:fixed;bottom:16px;left:16px;right:16px;height:64px;background:#ddd;z-index:40}${css}</style><main><div class="dashboard-radar-layout"><div class="dashboard-radar-cards"><section><p>Resumo inteligente do mês</p><div class="summary"><span>Receitas R$ 123.456.789,00</span><span>Despesas R$ 123.456.789,00</span><span>Saldo R$ 123.456.789,00</span></div></section><section>Outro card</section></div></div><div style="height:3000px"></div></main><nav><button>Gastos</button></nav>`);
    for (const y of [0, 1000, 2500]) {
      await page.evaluate(y => scrollTo(0,y), y);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
      await page.getByRole('button', {name:'Gastos'}).click();
    }
    console.log(`PASS ${width}px: grid constrained, navigation clickable at 3 scroll positions`);
    await page.close();
  }
} finally { await browser.close(); }
