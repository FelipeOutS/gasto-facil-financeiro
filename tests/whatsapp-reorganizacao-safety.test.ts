import { expect, test } from 'bun:test';
import { parseOpeningBalance, accountBalanceCents } from '../src/lib/account-opening-balance';
import { operationConfirmation, interpretReorganization } from '../src/lib/whatsapp-reorganizacao';
import { createReorganizationStore } from '../src/server/whatsapp-reorganizacao-store.server';
import { runReorganization, blockedReorganizationReply, type ReorganizationInput } from '../src/server/whatsapp-reorganizacao.server';
const operationId = '1990d398-1983-4e91-8856-e11dd2323f85';
const input: ReorganizationInput = { userId: 'A', phone: '5511999999999', externalId: 'audio1', text: '', localDate: '2026-11-03', pendingSession: false };
test('5000 opening balance is never income in compound audio text', () => {
 const intent=interpretReorganization('exclua minhas despesas e receitas anteriores e cadastre R$ 5.000 como saldo inicial da minha conta', input.localDate);
 expect(intent).toMatchObject({kind:'unsupported_balance',balance:{amountCents:500000,accountName:null}});
 expect('income' in intent).toBe(false);
});
test('named account without invented ID',()=>expect(parseOpeningBalance('tenho R$ 5.000 na Nubank como saldo inicial',input.localDate)).toEqual({accountName:'Nubank',amountCents:500000,effectiveDate:input.localDate}));
test('baseline excludes deleted and foreign movements',()=>{
 const b={userId:'A',accountId:'bank1',amountCents:500000,effectiveDate:'2026-11-03'};
 const m={userId:'A',accountId:'bank1',date:'2026-11-04',amountCents:-10000,deletedAt:null};
 expect(accountBalanceCents(b,[m,{...m,deletedAt:'2026-11-05'},{...m,userId:'B'},{...m,accountId:'bank2'},{...m,date:'2026-11-03'}])).toBe(490000);
});
test('exact restore operation and code required',()=>{
 expect(operationConfirmation(`RESTAURAR ${operationId} 004821`,'RESTAURAR')).toEqual({operationId,code:'004821'});
 expect(operationConfirmation('RESTAURAR sim','RESTAURAR')).toBeNull();
 expect(operationConfirmation('RESTAURAR 004821','RESTAURAR')).toBeNull();
});
test('restore request prepares only; exact confirmation RPC',async()=>{
 const calls:Array<{name:string,args:Record<string,unknown>}>=[];
 const store=createReorganizationStore({rpc:async(name,args)=>{calls.push({name,args});return {error:null,data:name==='wa_reorganization_authorized'?true:{status:'restore_preview',operationId,code:'123456',expenses:1,incomes:1}};}});
 await runReorganization({...input,text:`restaurar limpeza ${operationId}`},store);
 expect(calls.some(c=>c.name==='wa_reorganization_control')).toBe(false);
 await runReorganization({...input,text:`RESTAURAR ${operationId} 004821`},store);
 expect(calls.at(-1)).toEqual({name:'wa_reorganization_control',args:{p_user:'A',p_phone:input.phone,p_action:`restore:${operationId}:004821`}});
});
test('bare restore cannot call writer',async()=>{
 let writes=0;const store=createReorganizationStore({rpc:async name=>{if(name!=='wa_reorganization_authorized')writes++;return {data:true,error:null};}});
 await runReorganization({...input,text:'restaurar limpeza'},store);expect(writes).toBe(0);
});
test('new confirmations intercepted while locked',()=>{
 expect(blockedReorganizationReply(`RESTAURAR ${operationId} 004821`,false)).not.toBeNull();
 expect(blockedReorganizationReply(`APAGAR ${operationId} 004821`,false)).not.toBeNull();
});
