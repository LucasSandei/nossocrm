import React, { useMemo } from 'react';
import { Activity, Deal, Contact, Company } from '@/types';
import { ActivityRow } from './ActivityRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlarmClock, CalendarDays, CheckSquare, CalendarClock, CheckCheck } from 'lucide-react';
import { groupTasksByDueDate, type GroupedTasks } from '@/lib/utils/activityKind';

interface ActivitiesListProps {
    activities: Activity[];
    deals: Deal[];
    contacts: Contact[];
    companies: Company[];
    onToggleComplete: (id: string) => void;
    onEdit: (activity: Activity) => void;
    onDelete: (id: string) => void;
    selectedActivities?: Set<string>;
    onSelectActivity?: (id: string, selected: boolean) => void;
    onAddActivity?: () => void;
    /**
     * Grupos já calculados pelo controller. Quando ausente, a lista agrupa
     * sozinha — assim o componente continua utilizável com uma lista simples.
     */
    groups?: GroupedTasks;
}

/** Seções na ordem de trabalho: o que está atrasado vem sempre primeiro. */
const SECTIONS: ReadonlyArray<{
    key: keyof GroupedTasks;
    label: string;
    icon: typeof AlarmClock;
    tone: string;
}> = [
        { key: 'overdue', label: 'Atrasadas', icon: AlarmClock, tone: 'text-red-600 dark:text-red-400' },
        { key: 'today', label: 'Hoje', icon: CalendarDays, tone: 'text-primary-600 dark:text-primary-400' },
        { key: 'upcoming', label: 'Próximas', icon: CalendarClock, tone: 'text-slate-600 dark:text-slate-300' },
        { key: 'completed', label: 'Concluídas', icon: CheckCheck, tone: 'text-emerald-600 dark:text-emerald-400' },
    ];

/**
 * Lista de TAREFAS da aba Tarefas, separada por prazo.
 *
 * Só recebe tarefas (`CALL`/`MEETING`/`EMAIL`/`TASK`/`MESSAGE`); notas e
 * mudanças de estágio ficam na timeline do card do negócio.
 */
export const ActivitiesList: React.FC<ActivitiesListProps> = ({
    activities,
    deals,
    contacts,
    companies,
    onToggleComplete,
    onEdit,
    onDelete,
    selectedActivities = new Set(),
    onSelectActivity,
    onAddActivity,
    groups,
}) => {
    // Performance: a lista pode ser grande; evitamos `find` por linha (O(N*M)).
    const dealById = useMemo(() => {
        const map = new Map<string, Deal>();
        for (const d of deals) map.set(d.id, d);
        return map;
    }, [deals]);

    const contactById = useMemo(() => {
        const map = new Map<string, Contact>();
        for (const c of contacts) map.set(c.id, c);
        return map;
    }, [contacts]);

    const companyById = useMemo(() => {
        const map = new Map<string, Company>();
        for (const c of companies) map.set(c.id, c);
        return map;
    }, [companies]);

    const resolvedGroups = useMemo(
        () => groups ?? groupTasksByDueDate(activities),
        [groups, activities]
    );

    if (activities.length === 0) {
        return (
            <div className="bg-white dark:bg-dark-card rounded-xl border border-slate-200 dark:border-white/5 border-dashed">
                <EmptyState
                    icon={CheckSquare}
                    title="Nenhuma tarefa encontrada"
                    description="Crie uma tarefa para começar a acompanhar seu trabalho."
                    action={onAddActivity ? { label: 'Nova Tarefa', onClick: onAddActivity } : undefined}
                />
            </div>
        );
    }

    const renderRow = (activity: Activity) => (
        <ActivityRow
            key={activity.id}
            activity={activity}
            deal={activity.dealId ? dealById.get(activity.dealId) : undefined}
            contact={activity.contactId ? contactById.get(activity.contactId) : undefined}
            company={activity.clientCompanyId ? companyById.get(activity.clientCompanyId) : undefined}
            onToggleComplete={onToggleComplete}
            onEdit={onEdit}
            onDelete={onDelete}
            isSelected={selectedActivities.has(activity.id)}
            onSelect={onSelectActivity}
        />
    );

    return (
        <div className="space-y-8">
            {SECTIONS.map(({ key, label, icon: Icon, tone }) => {
                const items = resolvedGroups[key];
                if (items.length === 0) return null;

                return (
                    <section key={key}>
                        <h2 className={`flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-wider ${tone}`}>
                            <Icon size={14} aria-hidden="true" />
                            {label}
                            <span className="text-slate-400 dark:text-slate-500 font-semibold normal-case tracking-normal">
                                ({items.length})
                            </span>
                        </h2>
                        <div className="space-y-3">{items.map(renderRow)}</div>
                    </section>
                );
            })}
        </div>
    );
};
