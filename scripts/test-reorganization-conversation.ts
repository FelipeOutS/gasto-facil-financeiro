import {runReorganization,type ReorganizationInput} from '../src/server/whatsapp-reorganizacao.server';
import {createReorganizationStore} from '../src/server/whatsapp-reorganizacao-store.server';
// LOCAL DISPOSABLE DATABASE ONLY. Socket path supplied by isolated shell harness.
if(!process.env.PGHOST?.startsWith('/tmp/gi-pg-reorganization.'))throw Error('isolated_database_required');
const signatures:Record<string,string[]>={wa_reorganization_authorized:['p_user','p_phone'],wa_reorganization_prepare:['p_user','p_phone','p_request','p_scope','p_income','p_code','p_balance'],wa_reorganization_confirm:['p_user','p_phone','p_code','p_operation'],wa_reorganization_control:['p_user','p_phone','p_action'],wa_reorganization_restore_prepare:['p_user','p_phone','p_operation','p_code']};
const sqlValue=(v:unknown)=>v==null?'NULL':`'${(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")}'`;
const store=createReorganizationStore({rpc:async(name,args)=>{const keys=signatures[name];if(!keys)throw Error('unknown_rpc');const cmd=Bun.spawn(['psql','-X','-tA','-v','ON_ERROR_STOP=1','-c',`SELECT public.${name}(${keys.map(k=>sqlValue(args[k])).join(',')});`],{stdout:'pipe',stderr:'pipe'});const out=await new Response(cmd.stdout).text();const error=await new Response(cmd.stderr).text();if(await cmd.exited!==0){console.error(name,error);return {data:null,error:{message:error}};}return {data:out.trim()==="t"?true:out.trim()==="f"?false:JSON.parse(out.trim()),error:null};}});

const seed=Bun.spawn(['psql','-X','-v','ON_ERROR_STOP=1','-c',`INSERT INTO gastos(user_id,descricao,valor,data,forma_pagamento) VALUES('aaaaaaaa-0000-0000-0000-000000000001','E2E previous month',35,'1900-01-03','pix'); INSERT INTO receitas(user_id,descricao,valor,data) VALUES('aaaaaaaa-0000-0000-0000-000000000001','E2E previous income',1,'1900-01-03');`],{stdout:'pipe',stderr:'pipe'});if(await seed.exited!==0)throw Error(await new Response(seed.stderr).text());
const input:ReorganizationInput={userId:'aaaaaaaa-0000-0000-0000-000000000001',phone:'5511999999999',externalId:'e2e-transcribed-fixture',localDate:'1900-02-03',pendingSession:false,text:'GI, exclua todas as minhas despesas e receitas de todos os meses anteriores, mantenha os dados do mês atual e ajuste meu saldo do Nubank para R$ 5.000.'};
const preview=await runReorganization(input,store);
const command=preview?.match(/APAGAR ([\da-f-]{36}) (\d{6})/i);
if(!command||!preview?.includes('R$'))throw Error(`preview_failed:${preview}`);
const applied=await runReorganization({...input,text:command[0],externalId:'e2e-confirm'},store);
if(!applied?.includes('Reorganização concluída'))throw Error(`apply_failed:${applied}`);
const replay=await runReorganization({...input,text:command[0],externalId:'e2e-replay'},store);
if(!replay?.includes('já foi concluída'))throw Error('replay_failed');
const restore=await runReorganization({...input,text:`restaurar limpeza ${command[1]}`,externalId:'e2e-restore-request'},store);
const restoreCommand=restore?.match(/RESTAURAR ([\da-f-]{36}) (\d{6})/i);
if(!restoreCommand)throw Error(`restore_preview_failed:${restore}`);
const restored=await runReorganization({...input,text:restoreCommand[0],externalId:'e2e-restore-confirm'},store);
if(!restored?.includes('Restauração concluída'))throw Error(`restore_failed:${restored}`);
console.log('PASS: actual parser → conversation preview → SQL confirmation → replay → restore preview → SQL restoration (isolated fixtures)');