'use client';

import React, { useState } from 'react';
import { ClipboardCheck, Gift, Layers, Lock, Package, Receipt, Target } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useGoalProgress } from '@/lib/query/hooks';
import { toMonthKey } from '@/lib/supabase';
import { MonthSelector } from './components/MonthSelector';
import { GoalsTab } from './components/GoalsTab';
import { CommissionTiersTab } from './components/CommissionTiersTab';
import { ProductCommissionsTab } from './components/ProductCommissionsTab';
import { BonusesTab } from './components/BonusesTab';
import { ApprovalsTab } from './components/ApprovalsTab';
import { CommissionStatementTab } from './components/CommissionStatementTab';

type GoalsTabId = 'goals' | 'tiers' | 'products' | 'bonuses' | 'approvals' | 'statement';

const TABS: Array<{ id: GoalsTabId; name: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'goals', name: 'Metas', icon: Target },
  { id: 'tiers', name: 'Faixas de Comissão', icon: Layers },
  { id: 'products', name: 'Comissão por Produto', icon: Package },
  { id: 'bonuses', name: 'Bônus', icon: Gift },
  { id: 'approvals', name: 'Aprovações', icon: ClipboardCheck },
  { id: 'statement', name: 'Extrato', icon: Receipt },
];

/**
 * Gestão de Metas — exclusiva do Admin.
 *
 * O bloqueio aqui é conveniência de navegação; a garantia real é a RLS, que já
 * impede um vendedor de ler faixas, bônus ou as metas dos colegas mesmo que
 * chegue à rota por outro caminho.
 */
const GoalsPage: React.FC = () => {
  const { profile, loading } = useAuth();
  const [monthKey, setMonthKey] = useState(() => toMonthKey(new Date()));
  const [activeTab, setActiveTab] = useState<GoalsTabId>('goals');

  const { data: progress } = useGoalProgress(monthKey);
  const pendingCount = progress?.pendingCount ?? 0;

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Carregando…</div>;
  }

  if (profile?.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto mt-20 text-center">
        <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-4">
          <Lock className="text-slate-400" size={22} />
        </div>
        <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display mb-1">
          Acesso restrito
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          A Gestão de Metas é visível apenas para administradores. Sua meta individual e a da equipe
          aparecem na Visão Geral.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Gestão de Metas
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Metas, remuneração e aprovação das vendas que contam.
          </p>
        </div>

        <MonthSelector value={monthKey} onChange={setMonthKey} />
      </div>

      <div className="flex items-center gap-1 mb-8 border-b border-slate-200 dark:border-white/10 overflow-x-auto">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.name}
              {tab.id === 'approvals' && pendingCount > 0 && (
                <span className="min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold text-white bg-amber-500 rounded-full">
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 dark:bg-primary-400 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {activeTab === 'goals' && <GoalsTab monthKey={monthKey} />}
      {activeTab === 'tiers' && <CommissionTiersTab />}
      {activeTab === 'products' && <ProductCommissionsTab />}
      {activeTab === 'bonuses' && <BonusesTab />}
      {activeTab === 'approvals' && <ApprovalsTab monthKey={monthKey} />}
      {activeTab === 'statement' && <CommissionStatementTab monthKey={monthKey} />}
    </div>
  );
};

export default GoalsPage;
