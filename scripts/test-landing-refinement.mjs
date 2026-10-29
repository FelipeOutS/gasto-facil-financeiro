import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
// Public UI only. Never signs in, submits forms, or calls financial APIs.
const origin = process.env.LANDING_TEST_URL || 'http://127.0.0.1:3001';
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname), 'Localhost only');
const output = process.env.LANDING_TEST_OUTPUT || 'test-results/landing-refinement';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.LANDING_BROWSER || 'chrome' });
const results = [];
try {
 for (const [width,height] of [[390,844],[768,1024],[1440,900],[1920,1080]]) {
  const page = await browser.newPage({viewport:{width,height}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin); await page.waitForTimeout(1200);
  const consent=page.getByRole('button',{name:'Recusar opcionais',exact:true});
  if(await consent.isVisible()) await consent.click();
  for(let y=0;y<await page.evaluate(()=>document.body.scrollHeight);y+=650){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(50)}
  await page.waitForTimeout(500);
  assert.equal(await page.locator('main details').count(),0,'No structural accordions');
  for(const id of ['recursos','explorar-planejamento','facilite-sua-rotina']) {
   const group=page.locator('#'+id); const tabs=group.getByRole('tab');
   await tabs.first().scrollIntoViewIfNeeded();
   for(let i=0;i<await tabs.count();i++){
    await tabs.nth(i).click();await page.waitForTimeout(300);
    assert.equal(await group.locator('[role=tabpanel]:visible').count(),1,'Only one visible panel');
    const sizes=await group.evaluate(el=>({outer:el.querySelector('.gi-panel-viewport').getBoundingClientRect().height,inner:el.querySelector('[role=tabpanel]:not([hidden])').getBoundingClientRect().height}));
    assert(Math.abs(sizes.outer-sizes.inner)<3,JSON.stringify(sizes));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
   }
   await tabs.last().focus();await page.keyboard.press('Home');await expect(tabs.first()).toHaveAttribute('aria-selected','true');
   await page.keyboard.press('End');await expect(tabs.last()).toHaveAttribute('aria-selected','true');
   await page.keyboard.press('ArrowRight');await expect(tabs.first()).toHaveAttribute('aria-selected','true');
  }
  const routine=page.locator('#facilite-sua-rotina');await routine.getByRole('tab').nth(1).scrollIntoViewIfNeeded();await page.waitForTimeout(350);
  await page.evaluate(()=>{window.__samples=[];const start=performance.now();function sample(){const e=document.querySelector('#facilite-sua-rotina');window.__samples.push({y:scrollY,h:e.querySelector('.gi-panel-viewport').getBoundingClientRect().height,visible:[...e.querySelectorAll('[role=tabpanel]')].filter(p=>!p.hidden).length});if(performance.now()-start<500)requestAnimationFrame(sample)}sample()});
  await routine.getByRole('tab').nth(1).click();await page.waitForTimeout(550);
  const samples=await page.evaluate(()=>window.__samples);assert(samples.every(s=>s.visible===1&&s.h>100));
  assert(Math.max(...samples.map(s=>s.y))-Math.min(...samples.map(s=>s.y))<3,'Tab scroll jump');
  for(let i=0;i<6;i++)await routine.getByRole('tab').nth(i%2).click({force:true});await page.waitForTimeout(300);
  assert.equal(await routine.locator('[role=tabpanel]:visible').count(),1);
  await routine.getByRole('tab').first().click();
  const filters=page.locator('.gi-plan-filters button');
  for(const [i,count] of [[0,5],[1,2],[2,2],[3,1]]){await filters.nth(i).click();await expect(page.locator('.gi-plan-grid > *')).toHaveCount(count)}
  await filters.first().click();
  const faq=page.locator('.gi-faq button[data-state]').first();await faq.scrollIntoViewIfNeeded();await faq.click();await page.waitForTimeout(260);await faq.focus();await page.keyboard.press('Enter');await expect(faq).toHaveAttribute('data-state','open');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(150);await routine.getByRole('tab').nth(1).click();await page.waitForTimeout(50);
  assert.equal(await routine.locator('[role=tabpanel]:visible').evaluate(e=>e.getAnimations().length),0);
  await routine.getByRole('tab').first().click();await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(400);
  await page.screenshot({path:output+'/after-'+width+'.png',fullPage:true});
  for(const id of ['inicio','facilite-sua-rotina','planos'])await page.locator('#'+id).screenshot({path:output+'/after-'+width+'-'+id+'.png'});
  assert.deepEqual(errors,[]);
  results.push({width,height,pageHeight:await page.evaluate(()=>document.documentElement.scrollHeight),samples: samples.length,errors});await page.close();
 }
 await writeFile(output+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
} finally {await browser.close()}
