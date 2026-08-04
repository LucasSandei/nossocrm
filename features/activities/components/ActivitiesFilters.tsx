import React from 'react';
import { Search, Filter } from 'lucide-react';
import { TASK_TYPE_FILTER_OPTIONS, type TaskActivityType } from '@/lib/utils/activityKind';

interface ActivitiesFiltersProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filterType: TaskActivityType | 'ALL';
  setFilterType: (type: TaskActivityType | 'ALL') => void;
}

/** Busca e filtro de tipo da aba **Tarefas**. */
export const ActivitiesFilters: React.FC<ActivitiesFiltersProps> = ({
  searchTerm,
  setSearchTerm,
  filterType,
  setFilterType,
}) => {
  return (
    <div className="flex gap-4 mb-6">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
        <input
          type="text"
          placeholder="Buscar tarefas..."
          className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 text-slate-900 dark:text-white"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Filter size={20} className="text-slate-400" />
        <select
          className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary-500 text-slate-900 dark:text-white"
          value={filterType}
          onChange={e => setFilterType(e.target.value as TaskActivityType | 'ALL')}
          aria-label="Filtrar por tipo de tarefa"
        >
          <option value="ALL">Todos os tipos</option>
          {TASK_TYPE_FILTER_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
