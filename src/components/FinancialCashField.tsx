import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectTrigger,SelectValue,SelectContent,SelectItem } from "@/components/ui/select";
import { getBancos,useStore } from "@/lib/store";
import { FINANCIAL_GROUP_WRITER_AUTHORIZED } from "@/lib/financial-group-writer";
import type { FinancialCashInput } from "@/lib/financial-cash-input";
/** Dormant until candidate schema/writer release. Never silently drops a selected bank. */
export function FinancialCashField({value,onChange,kind,disabled=false}:{value:FinancialCashInput;onChange:(value:FinancialCashInput)=>void;kind:"expense"|"income";disabled?:boolean}) {
  const banks=useStore(()=>getBancos());
  if(!FINANCIAL_GROUP_WRITER_AUTHORIZED) return null;
  const local=value.cashEffectiveAt ? (()=>{const d=new Date(value.cashEffectiveAt);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);})() : "";
  return <div className="grid gap-3 sm:grid-cols-2">
    <div><Label>{kind==="expense"?"Conta de saída":"Conta de entrada"}</Label>
      <Select disabled={disabled} value={value.financialBankId??"unassigned"} onValueChange={id=>onChange(id==="unassigned"?{}:{...value,financialBankId:id})}>
        <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger><SelectContent>
          <SelectItem value="unassigned">Não informado</SelectItem>{banks.map(bank=><SelectItem key={bank.id} value={bank.id}>{bank.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div><div><Label>{kind==="expense"?"Pago em":"Recebido em"}</Label><Input disabled={disabled||!value.financialBankId} className="mt-1" type="datetime-local" value={local} onChange={e=>onChange({...value,cashEffectiveAt:e.target.value?new Date(e.target.value).toISOString():undefined})}/></div>
  </div>;
}