'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Target, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useGoalProgress } from '@/lib/query/hooks';
import { GoalProgressBar } from '@/features/goals/components/GoalProgressBar';
import { formatMonthLabel } from '@/features/goals/lib/format';

/**
 * Destaque de metas no topo da Visão Geral.
 *
 * É a primeira coisa que o vendedor vê ao abrir o CRM: quanto falta para bater
 * a meta, em porcentagem e em reais, individual e da equipe.
 *
 * Some para quem tem papel `suporte` — o papel não tem meta, e uma barra vazia
 * só faria parecer que ele está devendo resultado.
 */
export const GoalHighlight: React.FC = () => {
  const router = useRouter();
  const { profile } = useAuth();
  const { data: progress, isLoading } = useGoalProgress();

  if (profile?.role === 'suporte') return null;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm p-5 h-40 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (!progress) return null;

  // Sem nenhuma meta cadastrada, o bloco não tem o que destacar.
  if (!progress.individual.hasGoal && !progress.team.hasGoal) return null;

  const isAdmin = progress.role === 'admin';
  const pending = progress.pendingCount;

  const pendingHint =
    pending > 0
      ? isAdmin
        ? `${pending} venda${pending > 1 ? 's' : ''} aguardando sua aprovação`
        : `${pending} venda${pending > 1 ? 's' : ''} sua${pending > 1 ? 's' : ''} aguardando aprovação`
      : undefined;

  return (
    <div className="space-y-3 shrink-0">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
          <Target className="text-primary-500" size={20} />
          Metas de <span className="capitalize font-normal">{formatMonthLabel(progress.month)}</span>
        </h2>

        {isAdmin && (
          <button
            type="button"
            onClick={() => router.push('/metas')}
            className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            {pending > 0 ? `Aprovar ${pending} venda${pending > 1 ? 's' : ''}` : 'Gerenciar metas'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GoalProgressBar
          label="Minha meta"
          achieved={progress.individual.achieved}
          target={progress.individual.target}
          hasGoal={progress.individual.hasGoal}
          emphasis
          icon={<Target className="text-primary-500" size={16} />}
          hint={pendingHint}
        />

        <GoalProgressBar
          label="Meta da equipe"
          achieved={progress.team.achieved}
          target={progress.team.target}
          hasGoal={progress.team.hasGoal}
          emphasis
          icon={<Users className="text-primary-500" size={16} />}
        />
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Só entram vendas marcadas como Ganho e aprovadas pelo administrador.
      </p>
    </div>
  );
};
