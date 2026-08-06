'use client';

import React, { useState } from 'react';
import { Gift, Plus, Trash2 } from 'lucide-react';
import {
  useCreateRevenueBonus,
  useDeleteRevenueBonus,
  useRevenueBonuses,
  useUpdateRevenueBonus,
} from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/button';
import { formatBRL, parseAmount } from '../lib/format';
import type { BonusScope } from '../types';

/**
 * Bônus por patamar de faturamento.
 *
 * Acumulativos por definição: quem atinge 100k com patamares em 50k e 100k
 * recebe os dois. Isso está escrito na tela porque é a dúvida que sempre
 * aparece quando alguém cadastra o segundo patamar.
 */
export const BonusesTab: React.FC = () => {
  const { addToast } = useToast();
  const { data: bonuses = [], isLoading } = useRevenueBonuses();
  const createBonus = useCreateRevenueBonus();
  const updateBonus = useUpdateRevenueBonus();
  const deleteBonus = useDeleteRevenueBonus();

  const [name, setName] = useState('');
  const [threshold, setThreshold] = useState('');
  const [amount, setAmount] = useState('');
  const [scope, setScope] = useState<BonusScope>('individual');

  const parsedThreshold = parseAmount(threshold);
  const parsedAmount = parseAmount(amount);
  const canCreate =
    name.trim().length > 1 &&
    parsedThreshold !== null &&
    parsedThreshold >= 0 &&
    parsedAmount !== null &&
    parsedAmount >= 0;

  const handleCreate = () => {
    if (!canCreate) return;

    createBonus.mutate(
      {
        name: name.trim(),
        thresholdAmount: parsedThreshold,
        bonusAmount: parsedAmount,
        scope,
      },
      {
        onSuccess: () => {
          setName('');
          setThreshold('');
          setAmount('');
          addToast('Bônus criado.', 'success');
        },
        onError: (e) => addToast(`Erro ao criar bônus: ${(e as Error).message}`, 'error'),
      }
    );
  };

  const individual = bonuses.filter((b) => b.scope === 'individual');
  const team = bonuses.filter((b) => b.scope === 'team');

  const renderGroup = (title: string, description: string, list: typeof bonuses) => (
    <div>
      <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{title}</h4>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{description}</p>

      {list.length === 0 ? (
        <p className="text-sm text-slate-400 py-2">Nenhum bônus cadastrado.</p>
      ) : (
        <div className="space-y-2">
          {list.map((bonus) => (
            <div
              key={bonus.id}
              className={`flex flex-wrap items-center gap-3 p-3 rounded-lg border transition-colors ${
                bonus.active
                  ? 'border-slate-200 dark:border-white/10 bg-white/50 dark:bg-white/5'
                  : 'border-slate-100 dark:border-white/5 opacity-60'
              }`}
            >
              <div className="flex-1 min-w-[12rem]">
                <p className="font-medium text-slate-900 dark:text-white">{bonus.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ao atingir {formatBRL(bonus.thresholdAmount)}
                </p>
              </div>

              <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {formatBRL(bonus.bonusAmount)}
              </span>

              <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bonus.active}
                  onChange={(e) =>
                    updateBonus.mutate(
                      { id: bonus.id, updates: { active: e.target.checked } },
                      {
                        onError: (err) =>
                          addToast(`Erro ao atualizar: ${(err as Error).message}`, 'error'),
                      }
                    )
                  }
                  className="rounded border-slate-300 dark:border-slate-600"
                />
                Ativo
              </label>

              <button
                type="button"
                onClick={() =>
                  deleteBonus.mutate(bonus.id, {
                    onSuccess: () => addToast('Bônus removido.', 'success'),
                    onError: (e) => addToast(`Erro ao remover: ${(e as Error).message}`, 'error'),
                  })
                }
                className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                aria-label={`Remover bônus ${bonus.name}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm p-5">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2 mb-1">
          <Gift className="text-primary-500" size={20} />
          Novo bônus
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Valor fixo pago ao atingir um patamar de faturamento no mês. Os bônus são{' '}
          <strong>acumulativos</strong>: quem chega a {formatBRL(100000)} com patamares em{' '}
          {formatBRL(50000)} e {formatBRL(100000)} recebe os dois.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label htmlFor="bonus-name" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Nome
            </label>
            <input
              id="bonus-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Bônus 50k"
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label htmlFor="bonus-threshold" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Faturamento (R$)
            </label>
            <input
              id="bonus-threshold"
              type="text"
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="50000"
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label htmlFor="bonus-amount" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Bônus (R$)
            </label>
            <input
              id="bonus-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500"
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 mt-3">
          <div>
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Gatilho
            </span>
            <div className="flex gap-2">
              {(
                [
                  { id: 'individual' as const, label: 'Faturamento do vendedor' },
                  { id: 'team' as const, label: 'Faturamento da equipe' },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setScope(option.id)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    scope === option.id
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <Button type="button" onClick={handleCreate} disabled={!canCreate || createBonus.isPending}>
            <Plus className="h-4 w-4" />
            Adicionar bônus
          </Button>
        </div>
      </div>

      <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm p-5 space-y-6">
        {isLoading ? (
          <p className="text-sm text-slate-500">Carregando…</p>
        ) : (
          <>
            {renderGroup(
              'Bônus individuais',
              'Avaliados sobre o faturamento aprovado de cada vendedor no mês.',
              individual
            )}
            {renderGroup(
              'Bônus de equipe',
              'Avaliados sobre o faturamento aprovado de toda a equipe no mês.',
              team
            )}
          </>
        )}
      </div>
    </div>
  );
};
