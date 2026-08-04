import React, { useMemo, useState } from 'react';
import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ListTodo,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  useActivities,
  useCreateActivity,
  useUpdateActivity,
  useDeleteActivity,
} from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';
import type { Activity } from '@/types';
import {
  TASK_TYPE_LABELS,
  TASK_TYPE_OPTIONS,
  groupTasksByDueDate,
  isTaskActivity,
  toTaskType,
  type GroupedTasks,
  type TaskActivityType,
} from '@/lib/utils/activityKind';

interface ContactTasksPanelProps {
  /** Contato dono das tarefas. Sem ele o painel só sabe filtrar pelo negócio. */
  contactId?: string;
  /** Nome do contato, usado nos textos vazios. */
  contactName?: string;
  /** Negócio aberto no card — vincula as tarefas criadas aqui. */
  dealId: string;
  dealTitle: string;
  /** Empresa CRM associada, quando houver. */
  clientCompanyId?: string;
}

interface TaskDraft {
  title: string;
  type: TaskActivityType;
  date: string;
  time: string;
  description: string;
}

/** Data/hora padrão do formulário: hoje às 09:00. */
function emptyDraft(): TaskDraft {
  return {
    title: '',
    type: 'CALL',
    date: new Date().toISOString().split('T')[0],
    time: '09:00',
    description: '',
  };
}

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

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const TYPE_TONES: Record<TaskActivityType, string> = {
  CALL: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  MEETING: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  EMAIL: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
  TASK: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  MESSAGE: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
};

/**
 * Tarefas do contato aberto no card do board.
 *
 * Cria, conclui, edita e exclui — sempre no escopo deste contato/negócio. As
 * tarefas criadas aqui são as mesmas da aba **Tarefas**; a timeline do card
 * continua mostrando só o histórico (notas e mudanças de estágio).
 */
export const ContactTasksPanel: React.FC<ContactTasksPanelProps> = ({
  contactId,
  contactName,
  dealId,
  dealTitle,
  clientCompanyId,
}) => {
  const { data: activities = [] } = useActivities();
  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();
  const deleteActivity = useDeleteActivity();
  const { addToast } = useToast();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft);

  /**
   * Tarefas deste contato: as vinculadas ao negócio aberto e as que apontam
   * direto para o contato (inclusive tarefas criadas sem negócio).
   */
  const contactTasks = useMemo(() => {
    return activities.filter(activity => {
      if (!isTaskActivity(activity)) return false;
      if (dealId && activity.dealId === dealId) return true;
      if (contactId && activity.contactId === contactId) return true;
      return false;
    });
  }, [activities, contactId, dealId]);

  const groups = useMemo(() => groupTasksByDueDate(contactTasks), [contactTasks]);
  const pendingCount = groups.overdue.length + groups.today.length + groups.upcoming.length;

  const openNewTaskForm = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setIsFormOpen(true);
  };

  const openEditTaskForm = (task: Activity) => {
    const date = new Date(task.date);
    setEditingId(task.id);
    setDraft({
      title: task.title,
      type: toTaskType(task.type),
      date: date.toISOString().split('T')[0],
      time: date.toTimeString().slice(0, 5),
      description: task.description || '',
    });
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const title = draft.title.trim();
    if (!title) {
      addToast('Digite o título da tarefa.', 'warning');
      return;
    }

    const scheduledFor = new Date(`${draft.date}T${draft.time}`);
    if (Number.isNaN(scheduledFor.getTime())) {
      addToast('Data ou hora inválida.', 'warning');
      return;
    }

    if (editingId) {
      updateActivity.mutate(
        {
          id: editingId,
          updates: {
            title,
            type: draft.type,
            description: draft.description,
            date: scheduledFor.toISOString(),
          },
        },
        {
          onSuccess: () => {
            addToast('Tarefa atualizada', 'success');
            closeForm();
          },
          onError: (error: Error) => addToast(`Erro ao atualizar tarefa: ${error.message}`, 'error'),
        }
      );
      return;
    }

    createActivity.mutate(
      {
        activity: {
          title,
          type: draft.type,
          description: draft.description,
          date: scheduledFor.toISOString(),
          dealId,
          dealTitle,
          contactId: contactId || '',
          clientCompanyId,
          participantContactIds: contactId ? [contactId] : [],
          completed: false,
          user: { name: 'Eu', avatar: '' },
        },
      },
      {
        onSuccess: () => {
          addToast('Tarefa criada', 'success');
          closeForm();
        },
        onError: (error: Error) => addToast(`Erro ao criar tarefa: ${error.message}`, 'error'),
      }
    );
  };

  const handleToggleComplete = (task: Activity) => {
    updateActivity.mutate(
      { id: task.id, updates: { completed: !task.completed } },
      {
        onSuccess: () => addToast(task.completed ? 'Tarefa reaberta' : 'Tarefa concluída', 'success'),
        onError: (error: Error) => addToast(`Erro ao atualizar tarefa: ${error.message}`, 'error'),
      }
    );
  };

  const handleDelete = (task: Activity) => {
    if (!window.confirm(`Excluir a tarefa "${task.title}"?`)) return;
    deleteActivity.mutate(task.id, {
      onSuccess: () => addToast('Tarefa excluída', 'success'),
      onError: (error: Error) => addToast(`Erro ao excluir tarefa: ${error.message}`, 'error'),
    });
  };

  const renderTask = (task: Activity) => {
    const type = toTaskType(task.type);

    return (
      <div
        key={task.id}
        className={`group flex items-start gap-3 p-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl transition-colors hover:border-primary-500/50 ${
          task.completed ? 'opacity-60' : ''
        }`}
      >
        <button
          type="button"
          onClick={() => handleToggleComplete(task)}
          className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            task.completed
              ? 'bg-green-500 border-green-500 text-white'
              : 'border-slate-300 dark:border-slate-600 hover:border-green-500 text-transparent hover:text-green-500'
          }`}
          aria-label={task.completed ? 'Reabrir tarefa' : 'Concluir tarefa'}
          title={task.completed ? 'Reabrir tarefa' : 'Concluir tarefa'}
        >
          <CheckCircle2 size={12} fill="currentColor" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${TYPE_TONES[type]}`}
            >
              {TASK_TYPE_LABELS[type]}
            </span>
            <h4
              className={`text-sm font-medium text-slate-900 dark:text-white break-words ${
                task.completed ? 'line-through text-slate-500' : ''
              }`}
            >
              {task.title}
            </h4>
          </div>
          {task.description && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words">
              {task.description}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-400">
            {DATE_TIME_FORMATTER.format(new Date(task.date))}
          </p>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => openEditTaskForm(task)}
            className="p-1.5 text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-colors"
            aria-label={`Editar tarefa ${task.title}`}
            title="Editar"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={() => handleDelete(task)}
            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
            aria-label={`Excluir tarefa ${task.title}`}
            title="Excluir"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-700 dark:text-white flex items-center gap-2">
            <ListTodo size={16} /> Tarefas do contato
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {pendingCount === 0
              ? 'Nenhuma tarefa pendente'
              : `${pendingCount} ${pendingCount === 1 ? 'tarefa pendente' : 'tarefas pendentes'}`}
            {contactName ? ` • ${contactName}` : ''}
          </p>
        </div>
        {!isFormOpen && (
          <button
            type="button"
            onClick={openNewTaskForm}
            className="shrink-0 inline-flex items-center gap-1.5 bg-primary-600 hover:bg-primary-500 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors"
          >
            <Plus size={14} /> Nova Tarefa
          </button>
        )}
      </div>

      {isFormOpen && (
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-3 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {editingId ? 'Editar tarefa' : 'Nova tarefa'}
            </h4>
            <button
              type="button"
              onClick={closeForm}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              aria-label="Fechar formulário de tarefa"
            >
              <X size={16} />
            </button>
          </div>

          <input
            autoFocus
            type="text"
            value={draft.title}
            onChange={e => setDraft({ ...draft, title: e.target.value })}
            placeholder="Ex: Ligar para confirmar a proposta"
            aria-label="Título da tarefa"
            className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Tipo</label>
              <select
                value={draft.type}
                onChange={e => setDraft({ ...draft, type: e.target.value as TaskActivityType })}
                className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              >
                {TASK_TYPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Data</label>
              <input
                required
                type="date"
                value={draft.date}
                onChange={e => setDraft({ ...draft, date: e.target.value })}
                className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Hora</label>
              <input
                required
                type="time"
                value={draft.time}
                onChange={e => setDraft({ ...draft, time: e.target.value })}
                className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <textarea
            value={draft.description}
            onChange={e => setDraft({ ...draft, description: e.target.value })}
            placeholder="Detalhes da tarefa (opcional)..."
            aria-label="Descrição da tarefa"
            className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 min-h-[64px] resize-none"
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={createActivity.isPending || updateActivity.isPending}
              className="inline-flex items-center gap-1.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg text-xs font-bold transition-colors"
            >
              <Check size={14} />
              {editingId ? 'Salvar' : 'Criar Tarefa'}
            </button>
          </div>
        </form>
      )}

      {contactTasks.length === 0 ? (
        <div className="border border-dashed border-slate-200 dark:border-white/10 rounded-xl p-8 text-center">
          <ListTodo size={28} className="mx-auto text-slate-300 dark:text-slate-600" />
          <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">
            Nenhuma tarefa para este contato
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Crie uma tarefa para não perder o próximo passo com {contactName || 'este contato'}.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {SECTIONS.map(({ key, label, icon: Icon, tone }) => {
            const items = groups[key];
            if (items.length === 0) return null;

            return (
              <section key={key}>
                <h4
                  className={`flex items-center gap-2 mb-2 text-[11px] font-bold uppercase tracking-wider ${tone}`}
                >
                  <Icon size={13} aria-hidden="true" />
                  {label}
                  <span className="text-slate-400 dark:text-slate-500 font-semibold normal-case tracking-normal">
                    ({items.length})
                  </span>
                </h4>
                <div className="space-y-2">{items.map(renderTask)}</div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
