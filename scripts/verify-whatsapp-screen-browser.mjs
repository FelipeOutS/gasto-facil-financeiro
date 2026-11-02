import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
const root=process.cwd();
const mocks={
 '@tanstack/react-router':`import React from 'react';export const createFileRoute=()=>o=>o;export const Link=({to,children,...p})=>React.createElement('a',{...p,href:to},children);export const Navigate=()=>null;`,
 '@tanstack/react-start':`export const useServerFn=f=>f;`,
 '@/lib/auth-context':`export const useAuth=()=>({user:{id:'test-owner'},loading:false});`,
 '@/lib/use-plan':`export const usePlan=()=>({isAdminMaster:false});`,
 '@/components/MobileShell':`import React from 'react';export const MobileShell=({children})=>React.createElement('main',{style:{padding:16}},children);`,
 '@/components/ConfirmDialog':`export const confirmAsync=async()=>true;`,
 '@/lib/premium-error':`import{toast}from'sonner';export const toastFromError=e=>toast.error(e.message);`,
 '@/components/whatsapp/BetaAdminSection':`export const BetaAdminSection=()=>null;`,
 '@/integrations/supabase/client':`export const supabase={auth:{getUser:async()=>({data:{user:{id:'test-owner'}}})},from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},then(resolve){const s=window.__scenario;resolve({data:table==='whatsapp_links'?s.links:s.messages,error:s.fail===table?{message:'Simulated failure'}:null});}};return q;}};`,
};
const fnNames=['getWhatsAppConfigStatus','upsertWhatsAppLink','deleteWhatsAppLink','confirmWhatsAppLinkConsent'];
mocks['@/lib/whatsapp.functions']=fnNames.map(n=>`export async function ${n}(arg){window.__calls.push(${JSON.stringify(n)});const s=window.__scenario;if('${n}'==='getWhatsAppConfigStatus')return {enabled:true};if('${n}'==='deleteWhatsAppLink'){s.links=s.links.map(l=>({...l,ativo:false,revogado_em:new Date().toISOString(),verification_state:'revoked'}));return {ok:true};}if('${n}'==='upsertWhatsAppLink')return {status:'pending',telefone:arg.data.telefone,mensagem_confirmacao:'CONFIRMAR TESTELOCAL',expira_em:new Date(Date.now()+s.ttl).toISOString()};return {consentimento_atualizado:'ok'};}`).join('\n');
mocks['@/lib/whatsapp.functions'] += `export async function listOwnWhatsAppConsents(){window.__calls.push('listOwnWhatsAppConsents');if(window.__scenario.fail)throw Error('offline');return {links:window.__scenario.links};}`;
const adminSource=await fs.readFile('src/lib/whatsapp-admin.functions.ts','utf8');mocks['@/lib/whatsapp-admin.functions']=[...adminSource.matchAll(/export const (\w+)/g)].map(m=>`export const ${m[1]}=async()=>{throw Error('Admin not available in fixture')};`).join('\n');
const result=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';import{Route}from'./src/routes/whatsapp';import{WhatsAppConsentAccess}from'./src/components/whatsapp/WhatsAppConsentAccess';const Page=window.__privacy?WhatsAppConsentAccess:Route.component;createRoot(document.getElementById('root')).render(<><Page/><Toaster/></>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-services',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:null);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:root}));}}]});
const compiler=await compile(await fs.readFile('src/styles.css','utf8'),{base:path.resolve('src'),onDependency(){}});
async function texts(dir){const entries=await fs.readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?texts(path.join(dir,e.name)):/\.(tsx|ts)$/.test(e.name)?fs.readFile(path.join(dir,e.name),'utf8'):''))).flat();}
const candidates=(await texts('src')).flatMap(s=>[...s.matchAll(/["'`]([^"'`\n]+)["'`]/g)].flatMap(m=>m[1].split(/\s+/)));
const css=compiler.build(candidates);
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].text:req.url==='/style.css'?css:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch();const screenshots=await fs.mkdtemp(path.join(os.tmpdir(),'gi-whatsapp-ui-'));
const link={id:'test-link',telefone:'5511999998888',ativo:true,verification_state:'verified',opt_in_em:'2026-10-01',created_at:'2026-10-01',revogado_em:null};
const messages=Array.from({length:12},(_,i)=>({id:`message-${i}`,telefone:'5511999998888',texto:`Mensagem de teste ${i}`,status:'salva',gasto_id:null,recebida_em:'2026-10-31T12:00:00Z'}));
let count=0;
try{
 for(const theme of ['light','dark'])for(const width of [320,390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
 await page.addInitScript(({theme,link,messages})=>{window.__scenario={links:[link],messages,ttl:2000};window.__calls=[];window.addEventListener('DOMContentLoaded',()=>document.documentElement.className=theme);},{theme,link,messages});
 await page.goto(url);await page.getByText('Número vinculado',{exact:true}).waitFor({timeout:5000}).catch(async e=>{console.log(errors,await page.locator('body').innerText());throw e;});
 assert.equal(await page.getByText(/^Mensagem de teste \d+$/).count(),8);
 const conversation=await page.getByRole('link',{name:'Abrir conversa para enviar gasto'}).getAttribute('href');assert.match(conversation,/^https:\/\/wa\.me\/\d+$/);
 await page.getByRole('button',{name:'Mostrar mais mensagens'}).click();assert.equal(await page.getByText(/^Mensagem de teste \d+$/).count(),12);
 await page.getByRole('button',{name:'Conferir prévia (sem salvar)'}).click();assert.deepEqual(await page.evaluate(()=>window.__calls),['getWhatsAppConfigStatus']);
 await page.evaluate(()=>window.__scenario.links[0]={...window.__scenario.links[0],ativo:false,verification_state:'revoked',revogado_em:'2026-10-31'});
 await page.getByRole('button',{name:'Atualizar WhatsApp'}).click();await page.getByText('Confirmação necessária',{exact:true}).waitFor();await page.getByText('Inativo',{exact:true}).waitFor();
 await page.evaluate(()=>window.__scenario.fail='whatsapp_links');await page.getByRole('button',{name:'Atualizar WhatsApp'}).click();await page.getByRole('alert').filter({hasText:'Não foi possível atualizar os dados'}).waitFor();assert.equal(await page.getByText(/^Mensagem de teste \d+$/).count(),12);
 await page.evaluate(()=>{window.__scenario.fail=null;window.__scenario.links[0].verification_state='pending';});await page.getByRole('button',{name:'Atualizar WhatsApp'}).click();await page.getByText('Pendente de confirmação',{exact:true}).waitFor();
 await page.getByPlaceholder('(11) 99999-8888').fill('11999998888');await page.locator('#wa-opt-in').check();await page.getByRole('button',{name:'Adicionar outro'}).click();await page.getByRole('link',{name:'Abrir WhatsApp para confirmar'}).waitFor();const confirmation=new URL(await page.getByRole('link',{name:'Abrir WhatsApp para confirmar'}).getAttribute('href'));assert.equal(confirmation.origin,'https://wa.me');assert.equal(confirmation.searchParams.get('text'),'CONFIRMAR TESTELOCAL');await page.getByText('Confirmação expirada.',{exact:false}).waitFor({timeout:6000});assert.equal(await page.getByRole('link',{name:'Abrir WhatsApp para confirmar'}).count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${theme} ${width}`);assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(screenshots,`${theme}-${width}.png`),fullPage:true});await page.close();console.log(`PASS ${theme} ${width}: history, local preview, revoked/pending, failure recovery, expiration, layout`);count++;
 }
 const privacy=await browser.newPage({viewport:{width:390,height:900}});
 await privacy.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
 await privacy.addInitScript(({link})=>{window.__privacy=true;window.__scenario={links:[link],fail:true};window.__calls=[];},{link});
 await privacy.goto(url);await privacy.getByRole('alert').waitFor();
 await privacy.evaluate(()=>window.__scenario.fail=false);
 await privacy.getByRole('button',{name:'Tentar novamente'}).click();
 await privacy.getByText('Número terminado em 8888').waitFor();
 await privacy.getByRole('button',{name:'Revogar consentimento'}).click();
 await privacy.getByText('Nenhum vínculo para revogar.').waitFor();
 assert.deepEqual(await privacy.evaluate(()=>window.__calls),['listOwnWhatsAppConsents','listOwnWhatsAppConsents','deleteWhatsAppLink']);
 await privacy.close();count++;console.log('PASS privacy: failure, retry, own consent revocation only');
 console.log(`${count} browser scenarios passed; screenshots: ${screenshots}`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
