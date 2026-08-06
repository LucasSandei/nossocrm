'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMonthLabel, shiftMonth } from '../lib/format';
import { toMonthKey } from '@/lib/supabase';

interface MonthSelectorProps {
  value: string;
  onChange: (monthKey: string) => void;
}

/** Navegação entre meses. Todas as abas da Gestão de Metas compartilham o mesmo mês. */
export const MonthSelector: React.FC<MonthSelectorProps> = ({ value, onChange }) => {
  const currentMonth = toMonthKey(new Date());

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(shiftMonth(value, -1))}
        className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white transition-colors"
        aria-label="Mês anterior"
      >
        <ChevronLeft size={18} />
      </button>

      <span className="min-w-[10rem] text-center text-sm font-medium text-slate-700 dark:text-slate-200 capitalize">
        {formatMonthLabel(value)}
      </span>

      <button
        type="button"
        onClick={() => onChange(shiftMonth(value, 1))}
        className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white transition-colors"
        aria-label="Próximo mês"
      >
        <ChevronRight size={18} />
      </button>

      {value !== currentMonth && (
        <button
          type="button"
          onClick={() => onChange(currentMonth)}
          className="ml-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
        >
          Mês atual
        </button>
      )}
    </div>
  );
};
