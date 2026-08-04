/**
 * @fileoverview Taxonomia única de `Activity`: separa TAREFA de ATIVIDADE.
 *
 * A tabela `activities` guarda dois conceitos diferentes:
 *
 * - **TAREFA** (`CALL`, `MEETING`, `EMAIL`, `TASK`, `MESSAGE`): um compromisso
 *   futuro, agendável, que alguém precisa executar e concluir. É o que aparece
 *   na aba **Tarefas** e na aba de tarefas do card do negócio.
 *
 * - **ATIVIDADE** (`NOTE`, `STATUS_CHANGE`): registro de histórico, gerado ao
 *   anotar algo ou ao mover o negócio de estágio. Não se "conclui". É o que
 *   aparece na **timeline** do card do negócio.
 *
 * Todo filtro de UI deve usar os helpers daqui em vez de listar tipos na mão,
 * para que os dois lugares nunca voltem a se misturar.
 *
 * @module lib/utils/activityKind
 */

import type { Activity } from '@/types';

/** Tipos que representam TAREFAS (agendáveis e concluíveis). */
export const TASK_ACTIVITY_TYPES = ['CALL', 'MEETING', 'EMAIL', 'TASK', 'MESSAGE'] as const;

/** Tipos que representam ATIVIDADES de histórico (timeline). */
export const TIMELINE_ACTIVITY_TYPES = ['NOTE', 'STATUS_CHANGE'] as const;

export type TaskActivityType = (typeof TASK_ACTIVITY_TYPES)[number];
export type TimelineActivityType = (typeof TIMELINE_ACTIVITY_TYPES)[number];

const TASK_TYPE_SET: ReadonlySet<string> = new Set<string>(TASK_ACTIVITY_TYPES);

/** `true` quando o registro é uma TAREFA (aba Tarefas). */
export function isTaskActivity(activity: Pick<Activity, 'type'>): boolean {
  return TASK_TYPE_SET.has(activity.type);
}

/** `true` quando o registro é uma ATIVIDADE de histórico (timeline do card). */
export function isTimelineActivity(activity: Pick<Activity, 'type'>): boolean {
  return !TASK_TYPE_SET.has(activity.type);
}

/** Rótulos em pt-BR dos tipos de tarefa. */
export const TASK_TYPE_LABELS: Record<TaskActivityType, string> = {
  CALL: 'Ligação',
  MEETING: 'Reunião',
  EMAIL: 'Email',
  TASK: 'Tarefa',
  MESSAGE: 'Mensagem',
};

/** Rótulos no plural, usados nos filtros de tipo. */
export const TASK_TYPE_PLURAL_LABELS: Record<TaskActivityType, string> = {
  CALL: 'Ligações',
  MEETING: 'Reuniões',
  EMAIL: 'Emails',
  TASK: 'Tarefas',
  MESSAGE: 'Mensagens',
};

/** Opções `<select>` para o formulário de tarefa. */
export const TASK_TYPE_OPTIONS: ReadonlyArray<{ value: TaskActivityType; label: string }> =
  TASK_ACTIVITY_TYPES.map(value => ({ value, label: TASK_TYPE_LABELS[value] }));

/** Opções `<select>` para o filtro de tipo (plural). */
export const TASK_TYPE_FILTER_OPTIONS: ReadonlyArray<{ value: TaskActivityType; label: string }> =
  TASK_ACTIVITY_TYPES.map(value => ({ value, label: TASK_TYPE_PLURAL_LABELS[value] }));

/**
 * Normaliza qualquer tipo para um tipo de tarefa válido.
 * Registros de histórico (ou tipos desconhecidos) viram `TASK`.
 */
export function toTaskType(type?: string | null): TaskActivityType {
  return type && TASK_TYPE_SET.has(type) ? (type as TaskActivityType) : 'TASK';
}

// ============================================================================
// AGRUPAMENTO POR PRAZO
// ============================================================================

/** Prazo relativo de uma tarefa pendente. */
export type TaskDueBucket = 'overdue' | 'today' | 'upcoming';

/** Grupos de tarefas na ordem em que devem ser exibidos. */
export interface GroupedTasks {
  /** Atrasadas — vencidas e ainda pendentes. Sempre no topo. */
  overdue: Activity[];
  /** Do dia — vencem hoje e ainda pendentes. */
  today: Activity[];
  /** Futuras — em sequência, da mais próxima para a mais distante. */
  upcoming: Activity[];
  /** Concluídas — ficam por último, mais recentes primeiro. */
  completed: Activity[];
}

/** Timestamp da meia-noite de hoje (limite entre atrasado e hoje). */
function startOfTodayTs(reference: Date): number {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
}

/**
 * Classifica uma tarefa pendente em atrasada / hoje / futura.
 *
 * @param dateIso - Data da tarefa (ISO).
 * @param reference - "Agora" (injetável para testes).
 */
export function getTaskDueBucket(dateIso: string, reference: Date = new Date()): TaskDueBucket {
  const todayTs = startOfTodayTs(reference);
  const tomorrowTs = todayTs + 24 * 60 * 60 * 1000;
  const ts = Date.parse(dateIso);

  if (!Number.isFinite(ts)) return 'upcoming';
  if (ts < todayTs) return 'overdue';
  if (ts < tomorrowTs) return 'today';
  return 'upcoming';
}

/**
 * Agrupa tarefas na ordem de trabalho esperada em um CRM:
 * atrasadas → hoje → próximas → concluídas.
 *
 * Dentro de cada grupo pendente a ordenação é crescente por data (a mais
 * urgente primeiro); concluídas saem em ordem decrescente (as últimas feitas
 * aparecem primeiro).
 *
 * @param tasks - Lista de tarefas (já filtrada por `isTaskActivity`).
 * @param reference - "Agora" (injetável para testes).
 */
export function groupTasksByDueDate(tasks: Activity[], reference: Date = new Date()): GroupedTasks {
  const grouped: GroupedTasks = { overdue: [], today: [], upcoming: [], completed: [] };

  for (const task of tasks) {
    if (task.completed) {
      grouped.completed.push(task);
      continue;
    }
    grouped[getTaskDueBucket(task.date, reference)].push(task);
  }

  const byDateAsc = (a: Activity, b: Activity) => Date.parse(a.date) - Date.parse(b.date);
  grouped.overdue.sort(byDateAsc);
  grouped.today.sort(byDateAsc);
  grouped.upcoming.sort(byDateAsc);
  grouped.completed.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return grouped;
}

/**
 * Achata os grupos na ordem de exibição: atrasadas, hoje, próximas, concluídas.
 */
export function sortTasksByUrgency(tasks: Activity[], reference: Date = new Date()): Activity[] {
  const { overdue, today, upcoming, completed } = groupTasksByDueDate(tasks, reference);
  return [...overdue, ...today, ...upcoming, ...completed];
}
