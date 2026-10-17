import { BrandMascot, DashboardGuide } from "../BrandMascot";
import { type ReactNode } from "react";
import { ArrowUp, ArrowDown, Clock, Wallet, CreditCard, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { KpiCard, QuickActionsBar } from "./DashboardFinancialCards";
import { Money } from "../Money";
import type { Cartao } from "@/lib/types";
import { formatBRL } from "@/lib/format";

export function DashboardCards({ cartoes }: { cartoes: Cartao[] }) {
  return (
    <section className="finexy-cards finexy-surface">
      <header>
        <h2>
          <CreditCard size={19} /> Meus cartões
        </h2>
        <Link to="/cartoes" aria-label="Gerenciar cartões">
          <Plus size={16} /> Gerenciar
        </Link>
      </header>
      {cartoes.length ? (
        <div className="finexy-card-scroll">
          {cartoes.map((card, index) => (
            <Link
              to="/cartoes"
              key={card.id}
              className={`finexy-credit-card ${index % 2 ? "finexy-credit-green" : ""}`}
            >
              <div>
                <CreditCard size={20} />
                <span>{card.banco}</span>
              </div>
              <h3>{card.nome}</h3>
              <p>Limite cadastrado</p>
              <strong>{formatBRL(card.limiteTotal)}</strong>
              <footer>
                Fecha dia {card.diaFechamento}
                <span>Vence dia {card.diaVencimento}</span>
              </footer>
            </Link>
          ))}
        </div>
      ) : (
        <div className="finexy-empty">
          <BrandMascot pose="apresentador" className="gi-mascot-empty" />
          <p>Nenhum cartão cadastrado.</p>
          <Link to="/cartoes">Adicionar cartão</Link>
        </div>
      )}
    </section>
  );
}

export function DashboardOverview({
  saldo,
  totalEntradas,
  total,
  totalGuardado,
  aPagar,
  atrasadasCount,
  pendentesCount,
  chart,
  budget,
  cards,
  transactions,
}: {
  saldo: number;
  totalEntradas: number;
  total: number;
  totalGuardado: number;
  aPagar: number;
  atrasadasCount: number;
  pendentesCount: number;
  chart?: ReactNode;
  budget?: ReactNode;
  cards?: ReactNode;
  transactions?: ReactNode;
}) {
  return (
    <>
      <div className="finexy-dashboard-grid hidden lg:grid">
        <section className="finexy-main-card finexy-surface">
          <div className="finexy-card-heading">
            <h2>Resultado do mês</h2>
            <span>BRL</span>
          </div>
          <Money value={saldo} className="finexy-main-value" />
          <p className="finexy-result-note">Receitas menos despesas no período</p>
          <div className="finexy-primary-actions">
            <Link to="/adicionar">
              <Plus size={16} /> Adicionar gasto
            </Link>
            <Link to="/renda/nova">
              <ArrowUp size={16} /> Adicionar receita
            </Link>
          </div>
          <div className="finexy-wallets">
            <h3>
              Seu dinheiro <span>• Resumo financeiro</span>
            </h3>
            <div>
              {[
                {
                  label: "Guardado",
                  value: totalGuardado,
                  to: "/guardado",
                  hint: "Total reservado",
                },
                { label: "Receitas", value: totalEntradas, to: "/renda", hint: "Neste mês" },
                {
                  label: "A pagar",
                  value: aPagar,
                  to: "/contas-a-pagar",
                  hint: `${pendentesCount} pendente(s)`,
                },
              ].map((item) => (
                <Link key={item.label} to={item.to}>
                  <Wallet size={15} />
                  <span>{item.label}</span>
                  <Money value={item.value} />
                  <small>{item.hint}</small>
                </Link>
              ))}
            </div>
          </div>
        </section>
        <section
          className="premium-kpis finexy-kpis finexy-surface"
          aria-label="Indicadores do mês"
        >
          <KpiCard
            label="Receitas do mês"
            valueNum={totalEntradas}
            icon={<ArrowUp size={16} />}
            tone="success"
            hint="Entradas no período"
          />
          <KpiCard
            label="Despesas do mês"
            valueNum={total}
            icon={<ArrowDown size={16} />}
            tone="destructive"
            hint="Saídas no período"
          />
          <KpiCard
            label="Resultado mensal"
            valueNum={saldo}
            icon={<Wallet size={16} />}
            hint="Receitas − despesas"
          />
          <KpiCard
            label="Contas a pagar"
            valueNum={aPagar}
            icon={<Clock size={16} />}
            tone="warning"
            hint={
              atrasadasCount ? `${atrasadasCount} atrasada(s)` : `${pendentesCount} pendente(s)`
            }
          />
        </section>
        <div className="finexy-chart">{chart}</div>
        <div className="finexy-lower-left">
          {budget}
          {cards}
        </div>
        <div className="finexy-transactions">{transactions}</div>
      </div>
      <DashboardGuide />
      <div className="lg:hidden">
        <QuickActionsBar />
      </div>
    </>
  );
}
