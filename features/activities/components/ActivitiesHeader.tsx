import React from 'react';
import { Plus, LayoutList, Calendar as CalendarIcon } from 'lucide-react';

interface ActivitiesHeaderProps {
  viewMode: 'list' | 'calendar';
  setViewMode: (mode: 'list' | 'calendar') => void;
  onNewActivity: () => void;
  dateFilter?: 'ALL' | 'overdue' | 'today' | 'upcoming';
  /**
   * Esconde o alternador de visão.
   *
   * O calendário é uma grade semanal de 900px (8 colunas). No celular vira
   * scroll horizontal sem contexto, então a aba fica só na lista.
   */
  hideViewToggle?: boolean;
}

/** Cabeçalho da aba **Tarefas** (só tarefas; atividades ficam na timeline do card). */
export const ActivitiesHeader: React.FC<ActivitiesHeaderProps> = ({
  viewMode,
  setViewMode,
  onNewActivity,
  dateFilter = 'ALL',
  hideViewToggle = false,
}) => {
  const filterLabel =
    dateFilter === 'overdue'
      ? 'Atrasados'
      : dateFilter === 'today'
        ? 'Hoje'
        : dateFilter === 'upcoming'
          ? 'Próximos'
          : null;

  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6 sm:mb-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-display">
          Tarefas
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400">
            O que precisa ser feito: ligações, emails, mensagens, reuniões e tarefas
          </p>
          {filterLabel && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-300">
              Filtro: {filterLabel}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className={`${hideViewToggle ? 'hidden' : 'flex'} bg-white dark:bg-dark-card p-1 rounded-lg border border-slate-200 dark:border-white/10`}>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-md transition-all ${
              viewMode === 'list'
                ? 'bg-primary-50 text-primary-600 dark:bg-primary-500/20 dark:text-primary-400'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
            }`}
          >
            <LayoutList size={20} />
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`p-2 rounded-md transition-all ${
              viewMode === 'calendar'
                ? 'bg-primary-50 text-primary-600 dark:bg-primary-500/20 dark:text-primary-400'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
            }`}
          >
            <CalendarIcon size={20} />
          </button>
        </div>
        <button
          onClick={onNewActivity}
          className="flex flex-1 sm:flex-none items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-4 min-h-[44px] rounded-lg font-medium transition-colors shadow-lg shadow-primary-600/20"
        >
          <Plus size={20} />
          Nova Tarefa
        </button>
      </div>
    </div>
  );
};
