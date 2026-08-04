import { describe, it, expect } from 'vitest';
import type { Activity } from '@/types';
import {
  TASK_TYPE_OPTIONS,
  getTaskDueBucket,
  groupTasksByDueDate,
  isTaskActivity,
  isTimelineActivity,
  sortTasksByUrgency,
  toTaskType,
} from './activityKind';

/** "Agora" fixo para os testes: 15/03/2026 às 12:00. */
const NOW = new Date(2026, 2, 15, 12, 0, 0);

function task(overrides: Partial<Activity> & { id: string; date: string }): Activity {
  return {
    dealId: 'deal-1',
    dealTitle: 'Negócio',
    type: 'TASK',
    title: `Tarefa ${overrides.id}`,
    completed: false,
    user: { name: 'Eu', avatar: '' },
    ...overrides,
  };
}

describe('isTaskActivity / isTimelineActivity', () => {
  it('classifica os cinco tipos de tarefa', () => {
    for (const type of ['CALL', 'MEETING', 'EMAIL', 'TASK', 'MESSAGE'] as const) {
      expect(isTaskActivity({ type })).toBe(true);
      expect(isTimelineActivity({ type })).toBe(false);
    }
  });

  it('classifica notas e mudanças de estágio como histórico', () => {
    for (const type of ['NOTE', 'STATUS_CHANGE'] as const) {
      expect(isTaskActivity({ type })).toBe(false);
      expect(isTimelineActivity({ type })).toBe(true);
    }
  });
});

describe('toTaskType', () => {
  it('mantém tipos de tarefa válidos', () => {
    expect(toTaskType('MESSAGE')).toBe('MESSAGE');
    expect(toTaskType('CALL')).toBe('CALL');
  });

  it('reduz histórico e valores desconhecidos a TASK', () => {
    expect(toTaskType('NOTE')).toBe('TASK');
    expect(toTaskType('STATUS_CHANGE')).toBe('TASK');
    expect(toTaskType(undefined)).toBe('TASK');
    expect(toTaskType('QUALQUER_COISA')).toBe('TASK');
  });
});

describe('TASK_TYPE_OPTIONS', () => {
  it('oferece Mensagem além de reunião, ligação, email e tarefa', () => {
    expect(TASK_TYPE_OPTIONS.map(o => o.value)).toEqual([
      'CALL',
      'MEETING',
      'EMAIL',
      'TASK',
      'MESSAGE',
    ]);
    expect(TASK_TYPE_OPTIONS.find(o => o.value === 'MESSAGE')?.label).toBe('Mensagem');
  });
});

describe('getTaskDueBucket', () => {
  it('separa atrasada, hoje e futura em relação à referência', () => {
    expect(getTaskDueBucket(new Date(2026, 2, 14, 23, 59).toISOString(), NOW)).toBe('overdue');
    // Ainda é "hoje" mesmo que a hora já tenha passado.
    expect(getTaskDueBucket(new Date(2026, 2, 15, 8, 0).toISOString(), NOW)).toBe('today');
    expect(getTaskDueBucket(new Date(2026, 2, 15, 23, 59).toISOString(), NOW)).toBe('today');
    expect(getTaskDueBucket(new Date(2026, 2, 16, 0, 1).toISOString(), NOW)).toBe('upcoming');
  });
});

describe('groupTasksByDueDate', () => {
  const tasks = [
    task({ id: 'futura-distante', date: new Date(2026, 2, 20, 9, 0).toISOString() }),
    task({ id: 'hoje-tarde', date: new Date(2026, 2, 15, 18, 0).toISOString() }),
    task({ id: 'atrasada-recente', date: new Date(2026, 2, 14, 9, 0).toISOString() }),
    task({ id: 'futura-proxima', date: new Date(2026, 2, 16, 9, 0).toISOString() }),
    task({ id: 'atrasada-antiga', date: new Date(2026, 2, 10, 9, 0).toISOString() }),
    task({ id: 'hoje-cedo', date: new Date(2026, 2, 15, 8, 0).toISOString() }),
    task({ id: 'concluida-atrasada', date: new Date(2026, 2, 9, 9, 0).toISOString(), completed: true }),
  ];

  it('ordena atrasadas da mais antiga para a mais recente', () => {
    const { overdue } = groupTasksByDueDate(tasks, NOW);
    expect(overdue.map(t => t.id)).toEqual(['atrasada-antiga', 'atrasada-recente']);
  });

  it('ordena hoje e próximas por horário crescente', () => {
    const { today, upcoming } = groupTasksByDueDate(tasks, NOW);
    expect(today.map(t => t.id)).toEqual(['hoje-cedo', 'hoje-tarde']);
    expect(upcoming.map(t => t.id)).toEqual(['futura-proxima', 'futura-distante']);
  });

  it('tira concluídas dos grupos pendentes mesmo quando vencidas', () => {
    const { overdue, completed } = groupTasksByDueDate(tasks, NOW);
    expect(overdue.map(t => t.id)).not.toContain('concluida-atrasada');
    expect(completed.map(t => t.id)).toEqual(['concluida-atrasada']);
  });

  it('achata na ordem atrasadas → hoje → próximas → concluídas', () => {
    expect(sortTasksByUrgency(tasks, NOW).map(t => t.id)).toEqual([
      'atrasada-antiga',
      'atrasada-recente',
      'hoje-cedo',
      'hoje-tarde',
      'futura-proxima',
      'futura-distante',
      'concluida-atrasada',
    ]);
  });
});
