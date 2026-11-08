import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Isolated components, no account/backend. Measures DOM work, not phone FPS.
const browser = await chromium.launch();
try {
  for (const fixture of process.argv.slice(2)) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const html = await readFile(fixture, 'utf8');
    await page.route('**/*', route => route.fulfill({ body: html, contentType: 'text/html' }));
    await page.goto('http://localhost/app');
    await page.locator('.mobile-bottom-nav').waitFor();
    const result = await page.evaluate(async () => {
      const nav = document.querySelector('.mobile-bottom-nav');
      let queries = 0, writes = 0;
      const query = document.querySelector.bind(document);
      document.querySelector = function (selector) {
        if (selector.includes('[role="dialog"]')) queries++;
        return query(selector);
      };
      const observer = new MutationObserver(records => { writes += records.length; });
      observer.observe(nav, { attributes: true, attributeFilter: ['data-compact'] });
      for (let i = 1; i <= 60; i++) {
        scrollTo(0, i * 20);
        await new Promise(requestAnimationFrame);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      observer.disconnect();
      return { queries, writes, compact: nav.dataset.compact };
    });
    console.log(JSON.stringify({ fixture, ...result }));
    assert.equal(result.compact, 'true');
    if (process.argv.length === 3) {
      assert(result.queries <= 2, 'no per-frame document query during continuous scrolling');
      assert.equal(result.writes, 1, 'only one compact-state write');
      // Navigation must cancel work belonging to the previous route.
      await page.evaluate(() => scrollBy(0, 100));
      await page.locator('.mobile-nav-link[href="/gastos"]').click();
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.mobile-bottom-nav').getAttribute('data-compact'), 'false');
      assert.equal(await page.locator('#route-path').textContent(), '/gastos');
    }
    await page.close();
  }
} finally { await browser.close(); }
