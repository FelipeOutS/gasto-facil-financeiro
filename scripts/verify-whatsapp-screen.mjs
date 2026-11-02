import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const ui = fs.readFileSync('src/routes/whatsapp.tsx', 'utf8');
const server = fs.readFileSync('src/lib/whatsapp.functions.ts', 'utf8');
function findFunction(text, name) {
 const source=ts.createSourceFile('route.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
 function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found=n;ts.forEachChild(n,visit)}visit(source);
 assert(found, name);return found.getText(source);
}
const readSource=findFunction(ui,'verEmGastos');
for(const scenario of ['error','missing','found']) test('View expense: '+scenario,async()=>{
 const calls=[];const query={select(){return this},eq(){return this},is(){return this},async maybeSingle(){return {data:scenario==='found'?{id:'expense'}:null,error:scenario==='error'?{message:'offline'}:null}}};
 const sb={from(table){calls.push(table);return query}};const location={href:''};let caught=false;
 const fn=new Function('supabase','msg','busy','setBusy','toast','toastFromError','window',`${readSource};return verEmGastos;`)(sb,{gasto_id:'expense'},false,()=>{},{info(){}},()=>{caught=true},{location});
 await fn();assert.deepEqual(calls,['gastos']);assert.equal(caught,scenario==='error');assert.equal(location.href,scenario==='found'?'/gastos?highlight=expense':'');
});
for(const name of ['testarWebhookWhatsApp','deleteGastoFromWhatsApp','reprocessarMensagemWhatsApp','deleteWhatsAppMessageLog']) test('Legacy endpoint fails closed: '+name,async()=>{
 const segment=server.split('export const '+name+' =')[1].split('\nexport const ')[0];assert(segment.includes('.middleware([requireSupabaseAuth])'));
 const body=segment.split('.handler(async () => {')[1].split('\n  });')[0];assert(body);const fn=new (Object.getPrototypeOf(async()=>{}).constructor)(body);await assert.rejects(fn,/desativada/);
});
test('Preview cannot write or call webhook',async()=>{const code=findFunction(ui,'testarWebhook');let shown=false;const fn=new Function('toast',`${code};return testarWebhook;`)({info(){shown=true}});await fn();assert(shown);assert(!/fetch\(|supabase|processarMensagem/.test(code));});
test('History has no destructive client calls',()=>{assert(!/\.delete\(|\.update\(/.test(ui));assert(ui.includes('msgs.slice(0, visibleMessages)'));assert(ui.includes('request !== refreshSequence.current'));});
test('Webhook HMAC remains mandatory',()=>{assert(fs.readFileSync('src/routes/api/public.whatsapp.expense.ts','utf8').includes('if (!verifyMetaSignature(rawBody, sig))'));});

function serverHandler(name, dependencies) {
 const segment=server.split('export const '+name+' =')[1].split('\nexport const ')[0];
 const source=ts.createSourceFile('fn.ts',segment,ts.ScriptTarget.Latest,true);let handler;
 function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='handler')handler=n.arguments[0].getText(source);ts.forEachChild(n,visit)}visit(source);
 assert(handler);
 const js=ts.transpileModule('const fn = '+handler,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(dependencies),js+';return fn;')(...Object.values(dependencies));
}
for(const scenario of ['success','revoked-during-confirm','database-error']) test('Consent refresh: '+scenario,async()=>{
 const filters=[];let updating=false;
 const q={select(){return this},eq(k,v){filters.push([updating?'write':'read',k,v]);return this},is(k,v){filters.push([updating?'write':'read',k,v]);return this},order(){return this},limit(){return this},update(){updating=true;return this},async maybeSingle(){return updating?{data:scenario==='success'?{id:'link'}:null,error:scenario==='database-error'?new Error('db'):null}:{data:{id:'link',ativo:true,verification_state:'verified',revogado_em:null},error:null}}};
 const fn=serverHandler('confirmWhatsAppLinkConsent',{assertWhatsAppAccess:async()=>{},supabaseAdmin:{from:()=>q},WHATSAPP_CONSENT_REFRESH_VERSION:'test'});
 const result=await fn({data:{},context:{userId:'owner'}});
 assert.equal(result.consentimento_atualizado,scenario==='success'?'ok':'falhou');
 for(const condition of [['user_id','owner'],['ativo',true],['verification_state','verified'],['revogado_em',null]])assert(filters.some(f=>JSON.stringify(f)===JSON.stringify(['write',...condition])));
});
test('Privacy listing is owner scoped without paid access or history',async()=>{
 const calls=[];const q={select(v){calls.push(['select',v]);return this},eq(k,v){calls.push([k,v]);return this},async is(){return {data:[{id:'own',telefone:'5511999998888'}],error:null}}};
 const fn=serverHandler('listOwnWhatsAppConsents',{});
 const result=await fn({context:{userId:'owner',supabase:{from(t){assert.equal(t,'whatsapp_links');return q}}}});
 assert.equal(result.links.length,1);assert.deepEqual(calls,[['select','id, telefone'],['user_id','owner']]);
});
