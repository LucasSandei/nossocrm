import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { Activity } from '@/types';
import {
  useActivities,
  useCreateActivity,
  useUpdateActivity,
  useDeleteActivity,
} from '@/lib/query/hooks/useActivitiesQuery';
import { useDeals } from '@/lib/query/hooks/useDealsQuery';
import { useContacts, useCompanies } from '@/lib/query/hooks/useContactsQuery';
import { useRealtimeSync } from '@/lib/realtime/useRealtimeSync';
import {
  groupTasksByDueDate,
  isTaskActivity,
  sortTasksByUrgency,
  toTaskType,
  type TaskActivityType,
} from '@/lib/utils/activityKind';

/**
 * Estado e ações da aba **Tarefas**.
 *
 * Trabalha somente com TAREFAS (`CALL`, `MEETING`, `EMAIL`, `TASK`, `MESSAGE`).
 * Notas e mudanças de estágio ficam na timeline do card do negócio.
 */
export const useActivitiesController = () => {
  const searchParams = useSearchParams();

  // Auth for tenant organization_id
  const { profile, organizationId } = useAuth();

  // TanStack Query hooks
  const { data: activities = [], isLoading: activitiesLoading } = useActivities();
  const { data: deals = [], isLoading: dealsLoading } = useDeals();
  const { data: contacts = [], isLoading: contactsLoading } = useContacts();
  const { data: companies = [], isLoading: companiesLoading } = useCompanies();
  const createActivityMutation = useCreateActivity();
  const updateActivityMutation = useUpdateActivity();
  const deleteActivityMutation = useDeleteActivity();

  // Enable realtime sync
  useRealtimeSync('activities');

  const { showToast } = useToast();

  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<TaskActivityType | 'ALL'>('ALL');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'overdue' | 'today' | 'upcoming'>('ALL');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);

  // Permite deep-link do Inbox: /activities?filter=overdue|today|upcoming
  useEffect(() => {
    const filter = (searchParams.get('filter') || '').toLowerCase();

    if (filter === 'overdue' || filter === 'today' || filter === 'upcoming') {
      setDateFilter(filter);
      setViewMode('list');
      return;
    }

    // Qualquer outro valor (inclui vazio) cai no padrão.
    setDateFilter('ALL');
  }, [searchParams]);

  const [formData, setFormData] = useState({
    title: '',
    type: 'CALL' as TaskActivityType,
    date: new Date().toISOString().split('T')[0],
    time: '09:00',
    description: '',
    dealId: '',
  });

  const isLoading = activitiesLoading || dealsLoading || contactsLoading || companiesLoading;

  // Performance: build lookups once (avoid `.find(...)` in handlers).
  const activitiesById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const dealsById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  // Performance: compute date boundaries once per render (used inside memoized filters).
  const dateBoundaries = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { todayTs: today.getTime(), tomorrowTs: tomorrow.getTime() };
  }, []);

  /**
   * Esta aba mostra apenas TAREFAS. Notas e mudanças de estágio (`NOTE`,
   * `STATUS_CHANGE`) são histórico e vivem na timeline do card do negócio —
   * ver `lib/utils/activityKind.ts`.
   */
  const filteredActivities = useMemo(() => {
    const { todayTs, tomorrowTs } = dateBoundaries;
    const q = searchTerm.toLowerCase();

    const matching = activities
      .filter(isTaskActivity)
      .map((activity) => ({ activity, ts: Date.parse(activity.date) }))
      .filter(({ activity, ts }) => {
        const matchesSearch = (activity.title || '').toLowerCase().includes(q);
        const matchesType = filterType === 'ALL' || activity.type === filterType;
        const isPending = !activity.completed;

        const matchesDateFilter =
          dateFilter === 'ALL'
            ? true
            : dateFilter === 'overdue'
              ? isPending && ts < todayTs
              : dateFilter === 'today'
                ? isPending && ts >= todayTs && ts < tomorrowTs
                : isPending && ts >= tomorrowTs;

        return matchesSearch && matchesType && matchesDateFilter;
      })
      .map(({ activity }) => activity);

    // Ordem de trabalho: atrasadas → hoje → próximas → concluídas.
    return sortTasksByUrgency(matching);
  }, [activities, dateBoundaries, searchTerm, filterType, dateFilter]);

  /** Mesmos itens de `filteredActivities`, já separados por prazo para a lista. */
  const groupedActivities = useMemo(
    () => groupTasksByDueDate(filteredActivities),
    [filteredActivities]
  );

  const handleNewActivity = () => {
    setEditingActivity(null);
    setFormData({
      title: '',
      type: 'CALL',
      date: new Date().toISOString().split('T')[0],
      time: '09:00',
      description: '',
      dealId: '',
    });
    setIsModalOpen(true);
  };

  const handleEditActivity = (activity: Activity) => {
    setEditingActivity(activity);
    const date = new Date(activity.date);
    setFormData({
      title: activity.title,
      type: toTaskType(activity.type),
      date: date.toISOString().split('T')[0],
      time: date.toTimeString().slice(0, 5),
      description: activity.description || '',
      dealId: activity.dealId,
    });
    setIsModalOpen(true);
  };

  const handleDeleteActivity = (id: string) => {
    if (window.confirm('Tem certeza que deseja excluir esta tarefa?')) {
      deleteActivityMutation.mutate(id, {
        onSuccess: () => {
          showToast('Tarefa excluída com sucesso', 'success');
        },
      });
    }
  };

  const handleToggleComplete = useCallback(
    (id: string) => {
      const activity = activitiesById.get(id);
      if (!activity) return;

      updateActivityMutation.mutate(
        {
          id,
          updates: { completed: !activity.completed },
        },
        {
          onSuccess: () => {
            showToast(activity.completed ? 'Tarefa reaberta' : 'Tarefa concluída', 'success');
          },
        }
      );
    },
    [activitiesById, showToast, updateActivityMutation]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const date = new Date(`${formData.date}T${formData.time}`);
    const selectedDeal = formData.dealId ? dealsById.get(formData.dealId) : undefined;
    const selectedContact = selectedDeal?.contactId ? contactsById.get(selectedDeal.contactId) : undefined;
    const clientCompanyId = selectedDeal?.clientCompanyId || selectedContact?.clientCompanyId || undefined;
    const participantContactIds = selectedContact?.id ? [selectedContact.id] : [];

    if (editingActivity) {
      updateActivityMutation.mutate(
        {
          id: editingActivity.id,
          updates: {
            title: formData.title,
            type: formData.type,
            description: formData.description,
            date: date.toISOString(),
            dealId: formData.dealId || '',
            contactId: selectedContact?.id || '',
            clientCompanyId,
            participantContactIds,
          },
        },
        {
          onSuccess: () => {
            showToast('Tarefa atualizada com sucesso', 'success');
            setIsModalOpen(false);
          },
        }
      );
    } else {
      createActivityMutation.mutate(
        {
          activity: {
            title: formData.title,
            type: formData.type,
            description: formData.description,
            date: date.toISOString(),
            dealId: formData.dealId || '',
            contactId: selectedContact?.id || '',
            clientCompanyId,
            participantContactIds,
            dealTitle: selectedDeal?.title || '',
            completed: false,
            user: { name: 'Eu', avatar: '' },
          },
        },
        {
          onSuccess: () => {
            showToast('Tarefa criada com sucesso', 'success');
            setIsModalOpen(false);
          },
          onError: (error: Error) => {
            showToast(`Erro ao criar tarefa: ${error.message}`, 'error');
          },
        }
      );
    }
  };

  return {
    viewMode,
    setViewMode,
    searchTerm,
    setSearchTerm,
    filterType,
    setFilterType,
    dateFilter,
    setDateFilter,
    currentDate,
    setCurrentDate,
    isModalOpen,
    setIsModalOpen,
    editingActivity,
    formData,
    setFormData,
    filteredActivities,
    groupedActivities,
    deals,
    contacts,
    companies,
    isLoading,
    handleNewActivity,
    handleEditActivity,
    handleDeleteActivity,
    handleToggleComplete,
    handleSubmit,
  };
};
