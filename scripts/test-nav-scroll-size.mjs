import { chromium } from 'playwright';
import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const b=await chromium.launch();try{for(const width of [320,390,480]){
 const p=await b.newPage({viewport:{width,height:844}});const html=await readFile(process.argv[2],'utf8');await p.route('**/*',r=>r.fulfill({body:html,contentType:'text/html'}));await p.goto('http://localhost/app');const n=p.locator('.mobile-bottom-nav');await n.waitFor();
 const positions=await p.evaluate(async()=>{const n=document.querySelector('.mobile-bottom-nav');const samples=[];scrollTo(0,200);for(let i=0;i<24;i++){await new Promise(requestAnimationFrame);const r=n.getBoundingClientRect();samples.push({top:r.top,bottom:r.bottom,height:innerHeight})}return samples});
 assert(Math.max(...positions.map(r=>r.top))-Math.min(...positions.map(r=>r.top))<1,'vertical anchor drift');
 assert(positions.every(r=>r.bottom<=r.height-7),'safe bottom gap');await p.waitForFunction(()=>document.querySelector('.mobile-bottom-nav').dataset.compact==='true');await p.waitForTimeout(350);
 for(const box of await p.locator('.mobile-nav-link, .mobile-nav-create').evaluateAll(es=>es.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))))assert(box.w>=44&&box.h>=44);
 await p.evaluate(()=>scrollBy(0,-8));await p.waitForTimeout(50);assert.equal(await n.getAttribute('data-compact'),'true');
 await p.evaluate(()=>scrollBy(0,-50));await p.waitForFunction(()=>document.querySelector('.mobile-bottom-nav').dataset.compact==='false');
 await p.emulateMedia({reducedMotion:'reduce'});await p.evaluate(()=>scrollBy(0,100));await p.waitForTimeout(50);assert.equal(await n.getAttribute('data-compact'),'false');
 await p.emulateMedia({reducedMotion:'no-preference'});
 await p.evaluate(()=>{const d=document.createElement('div');d.setAttribute('aria-modal','true');d.id='test-modal';document.body.append(d);scrollBy(0,100)});await p.waitForTimeout(50);assert.equal(await n.getAttribute('data-compact'),'false');
 await p.evaluate(()=>{document.querySelector('#test-modal').remove();scrollTo(0,0)});await p.waitForTimeout(50);assert.equal(await n.getAttribute('data-compact'),'false');
 await p.locator('.mobile-nav-link[href="/gastos"]').click();await p.waitForTimeout(80);assert.equal(await n.getAttribute('data-compact'),'false');
 await p.close();console.log('PASS direction, hysteresis, touch targets, reduced motion width '+width);
}}finally{await b.close()}
