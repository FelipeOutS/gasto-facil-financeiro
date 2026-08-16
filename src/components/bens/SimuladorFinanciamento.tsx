import React, { useState, useMemo } from "react";
import { 
  Calculator, 
  TrendingDown, 
  Calendar, 
  Info, 
  ArrowRight,
  ChevronRight,
  TrendingUp,
  History
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL, parseBRLInput, formatBRLInput } from "@/lib/format";
import { 
  simularFinanciamento, 
  converterTaxaParaMensal,
  type ResultadoSimulacao 
} from "@/lib/financas";
import { type Financiamento } from "@/lib/bens";
import { cn } from "@/lib/utils";

interface SimuladorFinanciamentoProps {
  financiamento: Financiamento;
  saldoAtual: number;
}

export function SimuladorFinanciamento({ financiamento, saldoAtual }: SimuladorFinanciamentoProps) {
  const [valorExtra, setValorExtra] = useState("");
  const [tipoReducao, setTipoReducao] = useState<"prazo" | "parcela">("prazo");
  
  // Dados mínimos necessários
  const hasMinData = !!(
    financiamento.sistema_amortizacao && 
    financiamento.taxa_juros_anual && 
    financiamento.prazo_meses
  );

  const taxaMensal = useMemo(() => 
    converterTaxaParaMensal(
      financiamento.taxa_juros_anual || 0,
      financiamento.taxa_juros_periodicidade || "anual",
      financiamento.taxa_juros_tipo || "nominal"
    ),
    [financiamento.taxa_juros_anual, financiamento.taxa_juros_periodicidade, financiamento.taxa_juros_tipo]
  );

  // Simulação Cenário Atual (sem amortização extra)
  const cenarioAtual = useMemo(() => {
    if (!hasMinData) return null;
    return simularFinanciamento({
      sistema: financiamento.sistema_amortizacao === "sac" ? "sac" : "price",
      saldoDevedor: saldoAtual,
      taxaMensal,
      prazoRestante: financiamento.prazo_meses || 0,
      dataInicio: new Date().toISOString().split('T')[0],
    });
  }, [hasMinData, financiamento.sistema_amortizacao, saldoAtual, taxaMensal, financiamento.prazo_meses]);

  // Simulação Cenário Proposto
  const cenarioSimulado = useMemo(() => {
    if (!hasMinData || !valorExtra) return null;
    const valor = parseBRLInput(valorExtra);
    if (valor <= 0) return null;

    return simularFinanciamento({
      sistema: financiamento.sistema_amortizacao === "sac" ? "sac" : "price",
      saldoDevedor: saldoAtual,
      taxaMensal,
      prazoRestante: financiamento.prazo_meses || 0,
      dataInicio: new Date().toISOString().split('T')[0],
      amortizacaoExtra: valor,
      tipoReducao
    });
  }, [hasMinData, valorExtra, tipoReducao, financiamento.sistema_amortizacao, saldoAtual, taxaMensal, financiamento.prazo_meses]);

  if (!hasMinData) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center space-y-3">
            <Info className="h-8 w-8 text-muted-foreground" />
            <h3 className="font-medium text-sm">Dados insuficientes</h3>
            <p className="text-xs text-muted-foreground max-w-[280px]">
              Para simular, preencha a taxa de juros, sistema (SAC/Price) e prazo no cadastro do financiamento.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-amber-50/50 border border-amber-100 p-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <Calculator className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-semibold text-amber-900 uppercase tracking-wider">Simulador Financeiro</h4>
            <p className="text-[10px] text-amber-800 leading-relaxed mt-1">
              Taxa utilizada no motor: <strong className="font-bold">{(taxaMensal * 100).toFixed(4)}% a.m.</strong>
              <br />
              Origem: {financiamento.taxa_juros_anual}% {financiamento.taxa_juros_periodicidade === 'mensal' ? 'a.m.' : 'a.a.'} ({financiamento.taxa_juros_tipo || 'nominal'})
            </p>
          </div>
        </div>
        <p className="text-[9px] text-amber-700/80 italic border-t border-amber-200/50 pt-1.5">
          Valores aproximados baseados em {financiamento.sistema_amortizacao?.toUpperCase()}. O saldo real deve ser consultado no banco.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-medium">O que deseja simular?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">Valor da amortização extra hoje</Label>
              <Input
                placeholder="R$ 0,00"
                value={valorExtra}
                onChange={(e) => setValorExtra(formatBRLInput(e.target.value))}
                inputMode="decimal"
              />
              <div className="flex gap-2">
                {[1000, 5000, 10000, 20000].map(v => (
                  <Button 
                    key={v} 
                    variant="outline" 
                    size="sm" 
                    className="h-7 text-[10px] px-2"
                    onClick={() => setValorExtra(formatBRLInput(v.toString() + "00"))}
                  >
                    {formatBRL(v).replace(',00', '')}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Objetivo da redução</Label>
              <Select value={tipoReducao} onValueChange={(v: any) => setTipoReducao(v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prazo">Reduzir Prazo (Manter Parcela)</SelectItem>
                  <SelectItem value="parcela">Reduzir Parcela (Manter Prazo)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {cenarioSimulado && cenarioAtual && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase px-1">Impacto Estimado</h3>
            
            <div className="grid grid-cols-2 gap-3">
              <Card className="bg-muted/20">
                <CardContent className="p-3 space-y-1">
                  <div className="text-[10px] text-muted-foreground uppercase">Nova Parcela</div>
                  <div className="text-sm font-bold">
                    {formatBRL(cenarioSimulado.parcelas[0]?.valorParcela || 0)}
                  </div>
                  <div className={cn(
                    "text-[9px] font-medium",
                    cenarioSimulado.parcelas[0]?.valorParcela < cenarioAtual.parcelas[0]?.valorParcela 
                      ? "text-emerald-600" 
                      : "text-muted-foreground"
                  )}>
                    {cenarioSimulado.parcelas[0]?.valorParcela < cenarioAtual.parcelas[0]?.valorParcela
                      ? `Economia de ${formatBRL(cenarioAtual.parcelas[0].valorParcela - cenarioSimulado.parcelas[0].valorParcela)}/mês`
                      : "Valor mantido"}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-muted/20">
                <CardContent className="p-3 space-y-1">
                  <div className="text-[10px] text-muted-foreground uppercase">Meses Restantes</div>
                  <div className="text-sm font-bold">
                    {cenarioSimulado.parcelas.length} meses
                  </div>
                  {cenarioSimulado.mesesReduzidos !== undefined && cenarioSimulado.mesesReduzidos > 0 && (
                    <div className="text-[9px] font-medium text-emerald-600">
                      Redução de {cenarioSimulado.mesesReduzidos} meses
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="bg-emerald-50/50 border-emerald-100">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-emerald-900 uppercase tracking-wider flex items-center gap-1">
                    <TrendingDown className="h-3 w-3" />
                    Economia de Juros
                  </div>
                  <div className="text-2xl font-bold text-emerald-700">
                    {formatBRL(Math.max(0, cenarioAtual.totalJuros - cenarioSimulado.totalJuros))}
                  </div>
                  <p className="text-[9px] text-emerald-800">
                    Total que você deixará de pagar ao banco em juros futuros.
                  </p>
                </div>
                <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                  <TrendingUp className="h-6 w-6" />
                </div>
              </CardContent>
            </Card>

            <div className="rounded-xl border p-4 bg-card shadow-sm space-y-3">
               <div className="flex items-center justify-between text-xs">
                 <span className="text-muted-foreground">Data Estimada de Quitação</span>
                 <span className="font-bold flex items-center gap-1">
                   <Calendar className="h-3 w-3" />
                   {new Date(cenarioSimulado.dataQuitacao).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
                 </span>
               </div>
               {cenarioSimulado.mesesReduzidos !== undefined && cenarioSimulado.mesesReduzidos > 0 && (
                 <div className="flex items-center justify-between text-xs">
                   <span className="text-muted-foreground">Antecipação</span>
                   <span className="text-emerald-600 font-medium">
                     {Math.floor(cenarioSimulado.mesesReduzidos / 12)} anos e {cenarioSimulado.mesesReduzidos % 12} meses
                   </span>
                 </div>
               )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
