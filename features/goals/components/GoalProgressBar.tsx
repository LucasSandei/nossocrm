'use client';

import React from 'react';
import { goalPercent, goalRemaining } from '../lib/commission';
import { barWidth, formatBRL, progressColor } from '../lib/format';

interface GoalProgressBarProps {
  label: string;
  achieved: number;
  target: number;
  /** Sem meta cadastrada, mostramos só o realizado — barra de 0% seria mentira. */
  hasGoal: boolean;
  /** Variante de destaque, usada no card da Visão Geral. */
  emphasis?: boolean;
  icon?: React.ReactNode;
  /** Texto auxiliar sob o título (ex.: "3 vendas aguardando aprovação"). */
  hint?: string;
}

/**
 * Barra de progresso de meta: percentual, realizado e quanto falta.
 *
 * Compartilhada entre a Visão Geral e a Gestão de Metas para que vendedor e
 * Admin leiam exatamente o mesmo número da mesma forma.
 */
export const GoalProgressBar: React.FC<GoalProgressBarProps> = ({
  label,
  achieved,
  target,
  hasGoal,
  emphasis = false,
  icon,
  hint,
}) => {
  const percent = goalPercent(achieved, target);
  const remaining = goalRemaining(achieved, target);
  const reached = hasGoal && achieved >= target;

  return (
    <div
      className={
        emphasis
          ? 'glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm p-5'
          : 'rounded-lg border border-slate-200 dark:border-white/10 p-4'
      }
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate">
              {label}
            </h3>
          </div>
          {hint && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{hint}</p>}
        </div>

        {hasGoal && (
          <span
            className={`shrink-0 text-xs font-bold px-2 py-1 rounded-md ${
              reached
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300'
            }`}
          >
            {reached ? 'Meta batida' : 'Em andamento'}
          </span>
        )}
      </div>

      {hasGoal ? (
        <>
          <div className="flex items-end gap-2 mb-2">
            <span
              className={`font-bold text-slate-900 dark:text-white ${
                emphasis ? 'text-4xl' : 'text-2xl'
              }`}
            >
              {percent.toFixed(1)}%
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400 mb-1">
              de {formatBRL(target)}
            </span>
          </div>

          <div
            className="w-full bg-slate-100 dark:bg-white/10 rounded-full h-2.5 overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(percent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${label}: ${percent.toFixed(1)}% da meta`}
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressColor(percent)}`}
              style={{ width: barWidth(percent) }}
            />
          </div>

          <div className="flex justify-between mt-2.5 text-sm">
            <span className="text-slate-600 dark:text-slate-300">
              Realizado <strong className="text-slate-900 dark:text-white">{formatBRL(achieved)}</strong>
            </span>
            <span className={reached ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-slate-600 dark:text-slate-300'}>
              {reached ? `+${formatBRL(achieved - target)} acima` : `Faltam ${formatBRL(remaining)}`}
            </span>
          </div>
        </>
      ) : (
        <div>
          <div className="flex items-end gap-2">
            <span
              className={`font-bold text-slate-900 dark:text-white ${
                emphasis ? 'text-4xl' : 'text-2xl'
              }`}
            >
              {formatBRL(achieved)}
            </span>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
            Nenhuma meta definida para este mês.
          </p>
        </div>
      )}
    </div>
  );
};
