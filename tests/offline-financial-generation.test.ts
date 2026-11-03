import { expect, test } from 'bun:test';
import { cachedFinancialGeneration, rememberFinancialGeneration } from '../src/lib/offline/financial-generation';
import { normalizeOfflineError } from '../src/lib/offline/offline-error-messages';
test('generation cache is owner-scoped and monotonic; invalidates snapshot',()=>{
 const values=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});
 try {
 rememberFinancialGeneration('A',1);values.set('gi:offline:snapshot:A','old');rememberFinancialGeneration('A',2);rememberFinancialGeneration('A',1);
 expect(cachedFinancialGeneration('A')).toBe(2);expect(cachedFinancialGeneration('B')).toBeNull();expect(values.has('gi:offline:snapshot:A')).toBe(false);
 expect(()=>rememberFinancialGeneration('A',-1)).toThrow();
 } finally {Reflect.deleteProperty(globalThis,'localStorage');}
});
test('stale generation is review, not misleading network retry',()=>{
 const result=normalizeOfflineError(new Error('financial_generation_stale_review_required'));
 expect(result.technical).toBe('financial_generation_stale_review_required');
 expect(result.friendly.includes('conexão')).toBe(false);
});
