import {build} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const mocks={
 '@/lib/auth-context':`export const useAuth=()=>globalThis.fixture.auth;`,
 '@/lib/use-plan':`export const usePlan=()=>globalThis.fixture.plan;`,
 '@tanstack/react-router':`export const useNavigate=()=>()=>{};`,
 '@/components/MobileShell':`export const MobileShell=({children})=>children;`,
 '@/components/ui/button':`import React from 'react';export const Button=({children,...props})=><button {...props}>{children}</button>;`
};
const result=await build({stdin:{contents:`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{AdminMasterGate}from'./src/components/AdminMasterGate';globalThis.renderGate=()=>renderToStaticMarkup(<AdminMasterGate><strong>PRIVATE ADMIN</strong></AdminMasterGate>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:null);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
new Function('require',result.outputFiles[0].text)(createRequire(import.meta.url));
for(const [name,authLoading,planLoading,error,master,expected] of [
 ['auth loading',true,false,null,false,'Carregando'],
 ['slow plan',false,true,null,false,'Carregando'],
 ['refresh master',false,true,null,true,'Carregando'],
 ['query failure',false,false,'offline',false,'Não foi possível'],
 ['confirmed owner',false,false,null,true,'PRIVATE ADMIN'],
 ['confirmed denial',false,false,null,false,'Acesso restrito']]){
 globalThis.fixture={auth:{user:{id:'fixture'},loading:authLoading},plan:{loading:planLoading,error,isAdminMaster:master,refresh:async()=>{}}};
 const html=globalThis.renderGate();assert(html.includes(expected),name);if(expected!=='Acesso restrito')assert(!html.includes('Acesso restrito'),name);if(expected!=='PRIVATE ADMIN')assert(!html.includes('PRIVATE ADMIN'),name);console.log('PASS '+name);
}
const admin=await fs.readFile('src/routes/admin.tsx','utf8');assert(!admin.includes('setAuthorized'));assert(admin.includes('[authorized, reloadKey, user?.id]'));
const server=await fs.readFile('src/lib/admin.functions.ts','utf8');const dashboard=server.split('export const getAdminDashboard')[1].split('export const ')[0];assert(!dashboard.includes('reconcilePendingCardPaymentsForUser'));assert(dashboard.includes('if (result.error) throw'));
for(const file of ['admin_.atividade-usuarios.tsx','admin_.uso-produto.tsx','admin_.whatsapp-runtime.tsx']){const text=await fs.readFile('src/routes/'+file,'utf8');assert(text.includes('request !== requestId.current'));assert(text.includes('requestId.current++'));}
console.log('PASS main identity, read-only dashboard and report race contracts');

const pagination=await build({entryPoints:['src/server/admin-pagination.ts'],bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};new Function('module','exports',pagination.outputFiles[0].text)(module,module.exports);
const readAll=module.exports.readAllAdminRows;
for(const size of [0,500,1205,5201]) {
 const rows=Array.from({length:size},(_,id)=>({id}));
 const result=await readAll(async(from,to)=>({data:rows.slice(from,Math.min(to+1,from+100)),count:size,error:null}));
 assert.deepEqual(result.data,rows);console.log('PASS pagination '+size+' with server cap 100');
}
await assert.rejects(readAll(async()=>({data:null,count:10,error:Error('offline')})));
await assert.rejects(readAll(async()=>({data:[],count:10,error:null})));
let calls=0;await assert.rejects(readAll(async()=>({data:[{}],count:++calls===1?3:4,error:null})));
const deletion=server.split('export const deleteUserById')[1].split('async function ensureAdmin')[0];
assert(!deletion.includes('.delete('));assert(!deletion.includes('auth.admin.deleteUser'));assert(deletion.includes('throw new Error'));assert(deletion.includes('await ensureAdmin'));
const roles=await fs.readFile('src/lib/use-roles.tsx','utf8');assert(!roles.includes('localStorage'));assert(!roles.includes('claim_owner_if_first'));assert(roles.includes('state.userId === userId'));assert(roles.includes('request === generation'));
console.log('PASS pagination failures, deletion containment and role isolation contracts');

const roleBuild=await build({stdin:{contents:roles+'\nexport { loadRoles };',resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'roles-test',setup(b){b.onResolve({filter:/^@\//},a=>({path:a.path,namespace:'mock-role'}));b.onLoad({filter:/.*/,namespace:'mock-role'},a=>({contents:a.path.includes('auth-context')?'export const useAuth=()=>({});':'export const supabase=globalThis.roleDatabase;',loader:'js'}));}}]});
let queries=0;let resolveRead;
globalThis.roleDatabase={from(){queries++;return {select(){return this},eq(){return this},abortSignal(){return new Promise(resolve=>{resolveRead=resolve;});}}}};
const roleModule={exports:{}};new Function('require','module','exports',roleBuild.outputFiles[0].text)(createRequire(import.meta.url),roleModule,roleModule.exports);
const first=roleModule.exports.loadRoles('owner');const second=roleModule.exports.loadRoles('owner');assert.equal(queries,1);resolveRead({data:[{role:'owner'},{role:'invented'}],error:null});assert.deepEqual(await first,['owner']);await second;
const failed=roleModule.exports.loadRoles('owner');resolveRead({data:null,error:Error('offline')});await assert.rejects(failed);
const retry=roleModule.exports.loadRoles('owner');resolveRead({data:[{role:'user'}],error:null});assert.deepEqual(await retry,['user']);assert.equal(queries,3);
console.log('PASS role request deduplication, failure recovery and revoked role refresh');
