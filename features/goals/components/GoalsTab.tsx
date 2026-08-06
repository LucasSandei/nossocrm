'use client';

import React, { useMemo, useState } from 'react';
import { Copy, Target, Users } from 'lucide-react';
import { useCopyGoals, useGoalProgress, useSalesGoals, useSaveSalesGoal } from '@/lib/query/hooks';
import { useOrgMembersQuery } from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/button';
import { goalPercent, goalRemaining } from '../lib/commission';
import { barWidth, formatBRL, formatMonthLabel, parseAmount, progressColor, shiftMonth } from '../lib/format';
import { GoalProgressBar } from './GoalProgressBar';
import type { SellerProgress } from '../types';

interface GoalsTabProps {
  monthKey: string;
}

/** Campo de meta com edição inline: digita, sai do campo, salvou. */
const GoalAmountInput: React.FC<{
  value: number;
  onSave: (amount: number) => void;
  disabled?: boolean;
  ariaLabel: string;
}> = ({ value, onSave, disabled, ariaLabel }) => {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseAmount(draft);
    setDraft(null);
    if (parsed !== null && parsed !== value) onSave(parsed);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      disabled={disabled}
      value={draft ?? (value ? String(value) : '')}
      placeholder="0"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(null);
      }}
      className="w-36 px-3 py-2 text-right bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
    />
  );
};

/**
 * Metas do mês: a da equipe e a de cada vendedor.
 *
 * A meta da equipe é um valor próprio, não a soma das individuais — mas a soma
 * fica visível ao lado para o Admin perceber quando as duas se descolam.
 */
export const GoalsTab: React.FC<GoalsTabProps> = ({ monthKey }) => {
  const { addToast } = useToast();
  const { data: goals = [], isLoading } = useSalesGoals(monthKey);
  const { data: progress } = useGoalProgress(monthKey);
  const { data: members = [] } = useOrgMembersQuery();
  const saveGoal = useSaveSalesGoal();
  const copyGoals = useCopyGoals();

  const teamGoal = goals.find((g) => g.userId === null);

  /**
   * A RPC já devolve a lista com meta e realizado por vendedor, com `suporte`
   * fora. Se ela ainda não chegou, caímos nos membros da organização para a
   * tabela não aparecer vazia.
   */
  const sellers: SellerProgress[] = useMemo(() => {
    if (progress?.sellers?.length) return progress.sellers;
    return members.map((m) => ({
      userId: m.id,
      name: m.name,
      role: 'vendedor',
      target: goals.find((g) => g.userId === m.id)?.targetAmount ?? 0,
      achieved: 0,
    }));
  }, [progress, members, goals]);

  const individualSum = sellers.reduce((sum, s) => sum + s.target, 0);
  const teamTarget = teamGoal?.targetAmount ?? 0;
  const divergence = teamTarget - individualSum;

  const persist = (userId: string | null, amount: number) => {
    saveGoal.mutate(
      { userId, monthKey, targetAmount: amount },
      {
        onSuccess: () => addToast('Meta salva.', 'success'),
        onError: (e) => addToast(`Erro ao salvar meta: ${(e as Error).message}`, 'error'),
      }
    );
  };

  const handleCopyPrevious = () => {
    const previous = shiftMonth(monthKey, -1);
    copyGoals.mutate(
      { fromMonth: previous, toMonth: monthKey },
      {
        onSuccess: (count) =>
          addToast(
            count > 0
              ? `${count} meta${count > 1 ? 's' : ''} copiada${count > 1 ? 's' : ''} de ${formatMonthLabel(previous)}.`
              : 'Nada a copiar: as metas já existem ou o mês anterior está vazio.',
            count > 0 ? 'success' : 'info'
          ),
        onError: (e) => addToast(`Erro ao copiar metas: ${(e as Error).message}`, 'error'),
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Meta da equipe */}
      <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
              <Users className="text-primary-500" size={20} />
              Meta da equipe
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Valor próprio do mês — não é a soma das metas individuais.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <GoalAmountInput
              value={teamTarget}
              onSave={(amount) => persist(null, amount)}
              disabled={saveGoal.isPending}
              ariaLabel="Meta da equipe"
            />
            <Button type="button" variant="outline" size="sm" onClick={handleCopyPrevious} disabled={copyGoals.isPending}>
              <Copy className="h-4 w-4" />
              Copiar do mês anterior
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-slate-500 dark:text-slate-400">
            Soma das individuais: <strong className="text-slate-700 dark:text-slate-200">{formatBRL(individualSum)}</strong>
          </span>
          {teamTarget > 0 && divergence !== 0 && (
            <span className={divergence > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}>
              Divergência: {divergence > 0 ? '+' : ''}
              {formatBRL(divergence)}
            </span>
          )}
        </div>

        {progress && (
          <div className="mt-5">
            <GoalProgressBar
              label="Realizado da equipe no mês"
              achieved={progress.team.achieved}
              target={progress.team.target}
              hasGoal={progress.team.hasGoal}
            />
          </div>
        )}
      </div>

      {/* Metas individuais */}
      <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-white/5">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
            <Target className="text-primary-500" size={20} />
            Metas individuais
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Usuários com papel <strong>suporte</strong> não aparecem aqui — o papel não tem meta.
          </p>
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Carregando…</div>
        ) : sellers.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Nenhum vendedor cadastrado na organização.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5">
                  <th className="px-5 py-3 font-medium">Vendedor</th>
                  <th className="px-5 py-3 font-medium text-right">Meta</th>
                  <th className="px-5 py-3 font-medium text-right">Realizado</th>
                  <th className="px-5 py-3 font-medium w-52">Progresso</th>
                  <th className="px-5 py-3 font-medium text-right">Falta</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((seller) => {
                  const percent = goalPercent(seller.achieved, seller.target);
                  const remaining = goalRemaining(seller.achieved, seller.target);

                  return (
                    <tr
                      key={seller.userId}
                      className="border-b border-slate-50 dark:border-white/5 last:border-0"
                    >
                      <td className="px-5 py-3">
                        <span className="font-medium text-slate-900 dark:text-white">{seller.name}</span>
                        {seller.role === 'admin' && (
                          <span className="ml-2 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400">
                            admin
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <GoalAmountInput
                          value={seller.target}
                          onSave={(amount) => persist(seller.userId, amount)}
                          disabled={saveGoal.isPending}
                          ariaLabel={`Meta de ${seller.name}`}
                        />
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-slate-900 dark:text-white">
                        {formatBRL(seller.achieved)}
                      </td>
                      <td className="px-5 py-3">
                        {seller.target > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-100 dark:bg-white/10 rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${progressColor(percent)}`}
                                style={{ width: barWidth(percent) }}
                              />
                            </div>
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-300 w-12 text-right">
                              {percent.toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">sem meta</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {seller.target > 0 ? (
                          remaining > 0 ? (
                            <span className="text-slate-600 dark:text-slate-300">{formatBRL(remaining)}</span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">batida</span>
                          )
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="px-5 py-3 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-white/5">
          O realizado conta apenas vendas <strong>aprovadas</strong> na aba Aprovações.
        </p>
      </div>
    </div>
  );
};
