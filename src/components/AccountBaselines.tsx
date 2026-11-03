import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth-context";
import { useActiveAccount } from "@/lib/active-account";
import { readAccountBaselines, type AccountBaselineDisplay } from "@/lib/account-balances.functions";
import { Money } from "@/components/Money";
import { formatDateBR } from "@/lib/format";

/** Separate from monthly flows/reserves. Never claims an untracked bank-current balance. */
export function AccountBaselines() {
  const { user } = useAuth();
  const account = useActiveAccount();
  const read = useServerFn(readAccountBaselines);
  const [balances,setBalances] = useState<AccountBaselineDisplay[]>([]);
  useEffect(()=>{
    let active=true;
    setBalances([]);
    if (!user || (account.activeAccountId && account.activeAccountId !== user.id)) return;
    const refresh=()=>{ void read().then(r=>{ if(active) setBalances(r.balances); }).catch(()=>{ if(active) setBalances([]); }); };
    refresh();
    window.addEventListener("focus",refresh); window.addEventListener("online",refresh);
    return ()=>{active=false;window.removeEventListener("focus",refresh);window.removeEventListener("online",refresh);};
  },[user?.id,account.activeAccountId,read]);
  if(!balances.length) return null;
  return <section className="mt-5 border-y border-border py-4" aria-label="Saldos informados das contas">
    <h2 className="text-sm font-semibold">Saldos informados das contas</h2>
    <ul className="mt-3 grid gap-3 sm:grid-cols-2">{balances.map(b=><li key={b.id} className="min-w-0">
      <p className="text-sm font-medium break-words">{b.bankName}</p>
      <Money value={b.amountCents/100} className="block text-lg font-semibold" />
      <p className="text-xs text-muted-foreground">Saldo informado em {formatDateBR(b.effectiveDate)} · fim do dia</p>
    </li>)}</ul>
  </section>;
}