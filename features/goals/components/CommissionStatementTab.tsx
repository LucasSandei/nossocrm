'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Receipt } from 'lucide-react';
import {
  useApprovedSales,
  useCommissionTiers,
  useProductCommissions,
  useProducts,
  useRevenueBonuses,
} from '@/lib/query/hooks';
import { useGoalProgress } from '@/lib/query/hooks';
import { calculateCommissions, findTierAt } from '../lib/commission';
import { formatBRL, formatMonthLabel } from '../lib/format';

interface CommissionStatementTabProps {
  monthKey: string;
}

/**
 * Extrato de comissões do mês.
 *
 * Fecha o ciclo: as vendas aprovadas, passadas pelas faixas, pelas comissões de
 * produto e pelos bônus, resultam no valor a pagar por vendedor. Cada linha é
 * expansível para o Admin conseguir explicar o número quando alguém contestar.
 */
export const CommissionStatementTab: React.FC<CommissionStatementTabProps> = ({ monthKey }) => {
  const { data: sales = [], isLoading: loadingSales } = useApprovedSales(monthKey);
  const { data: tiers = [] } = useCommissionTiers();
  const { data: productCommissions = [] } = useProductCommissions();
  const { data: bonuses = [] } = useRevenueBonuses();
  const { data: products = [] } = useProducts();
  const { data: progress } = useGoalProgress(monthKey);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const productNames = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p.name])),
    [products]
  );

  const nameBySeller = useMemo(
    () => new Map((progress?.sellers ?? []).map((s) => [s.userId, s.name])),
    [progress]
  );

  const summary = useMemo(
    () => calculateCommissions(sales, tiers, productCommissions, bonuses, productNames),
    [sales, tiers, productCommissions, bonuses, productNames]
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const key = id ?? 'sem-responsavel';
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loadingSales) {
    return <div className="p-6 text-sm text-slate-500">Carregando…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Totais */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Faturamento aprovado', value: summary.teamRevenue },
          {
            label: 'Comissões',
            value: summary.sellers.reduce((sum, s) => sum + s.commission, 0),
          },
          {
            label: 'Bônus',
            value: summary.sellers.reduce((sum, s) => sum + s.bonus, 0) + summary.teamBonusTotal,
          },
          { label: 'Total a pagar', value: summary.grandTotal, emphasis: true },
        ].map((card) => (
          <div
            key={card.label}
            className={`glass rounded-xl border p-5 shadow-sm ${
              card.emphasis
                ? 'border-primary-200 dark:border-primary-900/40'
                : 'border-slate-200 dark:border-white/5'
            }`}
          >
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
              {card.label}
            </h3>
            <p
              className={`text-2xl font-bold ${
                card.emphasis
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {formatBRL(card.value)}
            </p>
          </div>
        ))}
      </div>

      {/* Extrato por vendedor */}
      <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-white/5">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
            <Receipt className="text-primary-500" size={20} />
            Extrato de <span className="capitalize font-normal">{formatMonthLabel(monthKey)}</span>
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Baseado apenas nas vendas aprovadas. Clique em uma linha para ver a composição.
          </p>
        </div>

        {summary.sellers.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Nenhuma venda aprovada neste mês.
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-white/5">
            {summary.sellers.map((seller) => {
              const key = seller.sellerId ?? 'sem-responsavel';
              const isOpen = expanded.has(key);
              const tier = findTierAt(tiers, seller.revenue);

              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className="w-full flex flex-wrap items-center gap-4 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                    aria-expanded={isOpen}
                  >
                    {isOpen ? (
                      <ChevronDown size={16} className="text-slate-400 shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="text-slate-400 shrink-0" />
                    )}

                    <div className="flex-1 min-w-[10rem]">
                      <p className="font-medium text-slate-900 dark:text-white">
                        {seller.sellerId
                          ? (nameBySeller.get(seller.sellerId) ?? 'Vendedor')
                          : 'Sem responsável'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {formatBRL(seller.revenue)} faturados
                        {tier && ` · faixa atual ${tier.ratePercent}%`}
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="block text-xs text-slate-400">Comissão</span>
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {formatBRL(seller.commission)}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="block text-xs text-slate-400">Bônus</span>
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {formatBRL(seller.bonus)}
                      </span>
                    </div>

                    <div className="text-right min-w-[7rem]">
                      <span className="block text-xs text-slate-400">Total</span>
                      <span className="text-lg font-bold text-slate-900 dark:text-white">
                        {formatBRL(seller.total)}
                      </span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-5 pl-14 space-y-3 bg-slate-50/50 dark:bg-white/[0.02]">
                      <div>
                        <h4 className="text-xs uppercase tracking-wide text-slate-400 mb-2 pt-3">
                          Composição da comissão
                        </h4>
                        {seller.lines.length === 0 ? (
                          <p className="text-sm text-slate-400">Sem comissão calculada.</p>
                        ) : (
                          <div className="space-y-1">
                            {seller.lines.map((line, index) => (
                              <div
                                key={`${line.label}-${index}`}
                                className="flex items-center justify-between text-sm py-1"
                              >
                                <span className="text-slate-600 dark:text-slate-300">
                                  {line.label}
                                  <span className="text-slate-400">
                                    {' '}
                                    · {formatBRL(line.base)} a {line.ratePercent}%
                                  </span>
                                </span>
                                <span className="font-medium text-slate-900 dark:text-white">
                                  {formatBRL(line.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {seller.bonuses.length > 0 && (
                        <div>
                          <h4 className="text-xs uppercase tracking-wide text-slate-400 mb-2">
                            Bônus atingidos
                          </h4>
                          <div className="space-y-1">
                            {seller.bonuses.map((bonus) => (
                              <div
                                key={bonus.id}
                                className="flex items-center justify-between text-sm py-1"
                              >
                                <span className="text-slate-600 dark:text-slate-300">
                                  {bonus.name}
                                  <span className="text-slate-400">
                                    {' '}
                                    · patamar {formatBRL(bonus.thresholdAmount)}
                                  </span>
                                </span>
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                  {formatBRL(bonus.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {summary.teamBonuses.length > 0 && (
          <div className="px-5 py-4 border-t border-slate-100 dark:border-white/5">
            <h4 className="text-xs uppercase tracking-wide text-slate-400 mb-2">
              Bônus de equipe
            </h4>
            {summary.teamBonuses.map((bonus) => (
              <div key={bonus.id} className="flex items-center justify-between text-sm py-1">
                <span className="text-slate-600 dark:text-slate-300">
                  {bonus.name}
                  <span className="text-slate-400"> · patamar {formatBRL(bonus.thresholdAmount)}</span>
                </span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {formatBRL(bonus.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
