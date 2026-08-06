'use client';

import React, { useState } from 'react';
import { Layers, Plus, Trash2, TriangleAlert } from 'lucide-react';
import {
  useCommissionTiers,
  useCreateCommissionTier,
  useDeleteCommissionTier,
  useUpdateCommissionTier,
} from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/button';
import { progressiveCommission, sortTiers } from '../lib/commission';
import { formatBRL, parseAmount } from '../lib/format';
import type { CommissionTier } from '../types';

/**
 * Aponta buracos e sobreposições entre as faixas.
 *
 * Vale o aviso porque nenhum dos dois casos dá erro no banco — a venda
 * simplesmente sai com a comissão errada, e ninguém percebe até o fechamento.
 */
function auditTiers(tiers: CommissionTier[]): string[] {
  const ordered = sortTiers(tiers);
  const issues: string[] = [];

  if (ordered.length === 0) return issues;

  if (ordered[0].minAmount > 0) {
    issues.push(`Nenhuma faixa cobre de ${formatBRL(0)} até ${formatBRL(ordered[0].minAmount)}.`);
  }

  for (let i = 0; i < ordered.length - 1; i++) {
    const current = ordered[i];
    const next = ordered[i + 1];

    if (current.maxAmount === null) {
      issues.push(`A faixa de ${current.ratePercent}% é aberta, mas há faixas acima dela.`);
      continue;
    }

    if (current.maxAmount < next.minAmount) {
      issues.push(
        `Intervalo sem comissão entre ${formatBRL(current.maxAmount)} e ${formatBRL(next.minAmount)}.`
      );
    } else if (current.maxAmount > next.minAmount) {
      issues.push(
        `Faixas sobrepostas entre ${formatBRL(next.minAmount)} e ${formatBRL(current.maxAmount)}.`
      );
    }
  }

  if (ordered[ordered.length - 1].maxAmount !== null) {
    issues.push(
      `Acima de ${formatBRL(ordered[ordered.length - 1].maxAmount!)} não há comissão. Deixe o teto da última faixa em branco para torná-la aberta.`
    );
  }

  return issues;
}

/** Célula editável de valor, salva ao sair do campo. */
const EditableCell: React.FC<{
  value: number | null;
  placeholder?: string;
  ariaLabel: string;
  suffix?: string;
  onSave: (value: number | null) => void;
}> = ({ value, placeholder, ariaLabel, suffix, onSave }) => {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    // Campo vazio no teto significa "faixa aberta", não zero.
    if (text === '') {
      if (value !== null) onSave(null);
      return;
    }
    const parsed = parseAmount(text);
    if (parsed !== null && parsed !== value) onSave(parsed);
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={draft ?? (value === null ? '' : String(value))}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(null);
        }}
        className="w-28 px-2 py-1.5 text-right bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      {suffix && <span className="text-xs text-slate-400 w-3">{suffix}</span>}
    </div>
  );
};

/**
 * Faixas de comissão por faturamento acumulado no mês.
 *
 * A conta é progressiva: uma venda que atravessa a fronteira entre duas faixas
 * é paga em partes. O simulador embaixo existe para deixar isso concreto antes
 * de alguém descobrir na folha de pagamento.
 */
export const CommissionTiersTab: React.FC = () => {
  const { addToast } = useToast();
  const { data: tiers = [], isLoading } = useCommissionTiers();
  const createTier = useCreateCommissionTier();
  const updateTier = useUpdateCommissionTier();
  const deleteTier = useDeleteCommissionTier();

  const [simulation, setSimulation] = useState('50000');

  const ordered = sortTiers(tiers);
  const issues = auditTiers(tiers);
  const simulated = parseAmount(simulation) ?? 0;
  const simulationResult = progressiveCommission(tiers, 0, simulated);

  const handleCreate = () => {
    // A nova faixa começa onde a última termina — o caso comum é empilhar.
    const last = ordered[ordered.length - 1];
    const minAmount = last?.maxAmount ?? (last ? last.minAmount + 10000 : 0);

    createTier.mutate(
      { minAmount, maxAmount: null, ratePercent: 5 },
      {
        onSuccess: () => addToast('Faixa criada.', 'success'),
        onError: (e) => addToast(`Erro ao criar faixa: ${(e as Error).message}`, 'error'),
      }
    );
  };

  const patch = (id: string, updates: Parameters<typeof updateTier.mutate>[0]['updates']) => {
    updateTier.mutate(
      { id, updates },
      { onError: (e) => addToast(`Erro ao salvar: ${(e as Error).message}`, 'error') }
    );
  };

  return (
    <div className="space-y-6">
      <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-white/5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
              <Layers className="text-primary-500" size={20} />
              Faixas de comissão
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
              A comissão é <strong>progressiva</strong>: cada parte do faturamento é paga pela faixa em
              que cai. Com 5% até {formatBRL(30000)} e 7% depois, uma venda que leva o acumulado de{' '}
              {formatBRL(28000)} a {formatBRL(34000)} paga 5% sobre {formatBRL(2000)} e 7% sobre{' '}
              {formatBRL(4000)}.
            </p>
          </div>

          <Button type="button" size="sm" onClick={handleCreate} disabled={createTier.isPending}>
            <Plus className="h-4 w-4" />
            Nova faixa
          </Button>
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Carregando…</div>
        ) : ordered.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            Nenhuma faixa cadastrada. Sem faixas, nenhuma comissão é calculada.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5">
                  <th className="px-5 py-3 font-medium text-right">De (R$)</th>
                  <th className="px-5 py-3 font-medium text-right">Até (R$)</th>
                  <th className="px-5 py-3 font-medium text-right">Comissão</th>
                  <th className="px-5 py-3 font-medium">Faixa</th>
                  <th className="px-5 py-3 w-12" />
                </tr>
              </thead>
              <tbody>
                {ordered.map((tier) => (
                  <tr key={tier.id} className="border-b border-slate-50 dark:border-white/5 last:border-0">
                    <td className="px-5 py-3">
                      <EditableCell
                        value={tier.minAmount}
                        ariaLabel="Início da faixa"
                        onSave={(v) => patch(tier.id, { minAmount: v ?? 0 })}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <EditableCell
                        value={tier.maxAmount}
                        placeholder="sem teto"
                        ariaLabel="Fim da faixa"
                        onSave={(v) => patch(tier.id, { maxAmount: v })}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <EditableCell
                        value={tier.ratePercent}
                        ariaLabel="Porcentagem de comissão"
                        suffix="%"
                        onSave={(v) => patch(tier.id, { ratePercent: v ?? 0 })}
                      />
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                      {formatBRL(tier.minAmount)} —{' '}
                      {tier.maxAmount === null ? 'em diante' : formatBRL(tier.maxAmount)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          deleteTier.mutate(tier.id, {
                            onSuccess: () => addToast('Faixa removida.', 'success'),
                            onError: (e) => addToast(`Erro ao remover: ${(e as Error).message}`, 'error'),
                          });
                        }}
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                        aria-label={`Remover faixa de ${tier.ratePercent}%`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {issues.length > 0 && (
          <div className="m-5 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">
              <TriangleAlert size={16} />
              Revise a configuração
            </p>
            <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-400 list-disc list-inside">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Simulador */}
      <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm p-5">
        <h3 className="text-base font-bold text-slate-900 dark:text-white font-display mb-1">
          Simulador
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Quanto um vendedor recebe ao fechar o mês com determinado faturamento (sem considerar
          produtos com comissão própria nem bônus).
        </p>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label
              htmlFor="tier-simulation"
              className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Faturamento no mês
            </label>
            <input
              id="tier-simulation"
              type="text"
              inputMode="decimal"
              value={simulation}
              onChange={(e) => setSimulation(e.target.value)}
              className="w-40 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="pb-1">
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Comissão total
            </span>
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {formatBRL(simulationResult.total)}
            </span>
          </div>
        </div>

        {simulationResult.lines.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {simulationResult.lines.map((line, index) => (
              <div
                key={`${line.label}-${index}`}
                className="flex items-center justify-between text-sm py-1.5 border-b border-slate-50 dark:border-white/5 last:border-0"
              >
                <span className="text-slate-600 dark:text-slate-300">
                  {formatBRL(line.base)} a {line.ratePercent}%
                </span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {formatBRL(line.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
