/**
 * Overdue Activities Analyzer
 * Detecta atividades atrasadas que precisam de ação
 */

import { Activity, DealView } from '@/types';
import { Decision, AnalyzerResult, AnalyzerConfig, SuggestedAction } from '../types';
import { TASK_ACTIVITY_TYPES, TASK_TYPE_LABELS, toTaskType } from '@/lib/utils/activityKind';

// Performance: reuse date formatter to avoid repeated `toLocaleDateString` allocations.
const PT_BR_DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR');

export const overdueActivitiesConfig: AnalyzerConfig = {
  id: 'overdue_activities',
  name: 'Atividades Atrasadas',
  description: 'Detecta atividades não concluídas que já passaram da data',
  enabled: true,
  params: {
    criticalDaysOverdue: 3,
    // Só TAREFAS atrasam; notas e mudanças de estágio são histórico.
    includedTypes: [...TASK_ACTIVITY_TYPES],
  },
  maxDecisionsPerRun: 10,
  cooldownDays: 1,
};

function generateReasoning(activity: Activity, daysOverdue: number, deal?: DealView): string {
  const parts: string[] = [];
  
  const typeLabel = TASK_TYPE_LABELS[toTaskType(activity.type)];

  parts.push(`${typeLabel} "${activity.title}" está ${daysOverdue} ${daysOverdue === 1 ? 'dia' : 'dias'} atrasada.`);
  
  if (deal) {
    parts.push(`Esta atividade está vinculada ao deal "${deal.title}" (R$ ${deal.value.toLocaleString('pt-BR')}).`);
    
    if (deal.probability >= 60) {
      parts.push('O deal está em estágio avançado, então este atraso pode impactar o fechamento.');
    }
  }
  
  if (daysOverdue > 3) {
    parts.push('Recomendo reagendar para uma data próxima ou concluir imediatamente.');
  }
  
  return parts.join(' ');
}

function generateSuggestedActions(activity: Activity, deal?: DealView): {
  primary: SuggestedAction;
  alternatives: SuggestedAction[];
} {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  // Reduz a um tipo de tarefa válido (exclui NOTE e STATUS_CHANGE).
  const validType = toTaskType(activity.type);

  // Primary action: Complete now or reschedule
  const primary: SuggestedAction = {
    id: crypto.randomUUID(),
    type: 'create_activity',
    label: 'Reagendar',
    icon: 'CalendarPlus',
    payload: {
      activityType: validType,
      activityTitle: activity.title,
      activityDate: tomorrow.toISOString(),
      activityDescription: `Reagendado de ${PT_BR_DATE_FORMATTER.format(new Date(activity.date))}. ${activity.description || ''}`,
      dealId: activity.dealId,
    },
    preview: {
      title: activity.title,
      scheduledFor: tomorrow.toISOString(),
      recipient: deal?.contactName,
    },
    requiresConfirmation: true,
    allowEdit: true,
  };

  // Alternative: mark as complete
  const alternatives: SuggestedAction[] = [
    {
      id: crypto.randomUUID(),
      type: 'dismiss',
      label: 'Marcar como Feita',
      icon: 'CheckCircle',
      payload: {
        activityType: validType,
        dealId: activity.dealId,
      },
      requiresConfirmation: false,
      allowEdit: false,
    },
  ];

  // If it's a call/meeting, offer to send message instead
  if (activity.type === 'CALL' || activity.type === 'MEETING') {
    alternatives.push({
      id: crypto.randomUUID(),
      type: 'send_message',
      label: 'Enviar WhatsApp',
      icon: 'MessageCircle',
      payload: {
        channel: 'whatsapp',
        recipient: deal?.contactName,
        messageTemplate: `Olá! Não consegui falar com você ${activity.type === 'CALL' ? 'por telefone' : 'na reunião'} no dia ${PT_BR_DATE_FORMATTER.format(new Date(activity.date))}. Podemos remarcar?`,
        dealId: activity.dealId,
        contactId: deal?.contactId,
      },
      requiresConfirmation: true,
      allowEdit: true,
    });
  }

  return { primary, alternatives };
}

/**
 * Função pública `analyzeOverdueActivities` do projeto.
 *
 * @param {Activity[]} activities - Parâmetro `activities`.
 * @param {DealView[]} deals - Parâmetro `deals`.
 * @param {AnalyzerConfig} config - Parâmetro `config`.
 * @returns {AnalyzerResult} Retorna um valor do tipo `AnalyzerResult`.
 */
export function analyzeOverdueActivities(
  activities: Activity[],
  deals: DealView[],
  config: AnalyzerConfig = overdueActivitiesConfig
): AnalyzerResult {
  const params = config.params as {
    criticalDaysOverdue: number;
    includedTypes: string[];
  };

  const nowTs = Date.now();
  const nowIso = new Date(nowTs).toISOString();
  const decisions: Decision[] = [];
  let analyzed = 0;

  // Create deal lookup map
  const dealMap = new Map(deals.map(d => [d.id, d]));

  /**
   * Performance: parse dates once and sort by timestamp (avoid `new Date(...)` in comparator).
   */
  const overdueActivities = activities
    .filter(activity => {
      if (activity.completed) return false;
      if (!params.includedTypes.includes(activity.type)) return false;
      return Date.parse(activity.date) < nowTs;
    })
    .map((activity) => ({ activity, ts: Date.parse(activity.date) }))
    // Sort by how overdue they are (oldest first)
    .sort((a, b) => a.ts - b.ts);

  for (const { activity, ts } of overdueActivities) {
    analyzed++;
    
    const daysOverdue = Math.floor(
      (nowTs - ts) / (1000 * 60 * 60 * 24)
    );
    
    const deal = activity.dealId ? dealMap.get(activity.dealId) : undefined;
    
    const priority = daysOverdue >= params.criticalDaysOverdue ? 'critical' :
                    daysOverdue >= 2 ? 'high' : 'medium';

    const { primary, alternatives } = generateSuggestedActions(activity, deal);

    const TYPE_EMOJI: Record<string, string> = {
      CALL: '📞', MEETING: '📅', EMAIL: '📧', TASK: '✅', MESSAGE: '💬',
    };
    const taskType = toTaskType(activity.type);
    const typeLabel = `${TYPE_EMOJI[taskType]} ${TASK_TYPE_LABELS[taskType]}`;

    decisions.push({
      id: crypto.randomUUID(),
      type: 'overdue_activity',
      priority,
      category: 'deadline',
      title: `${typeLabel} atrasada: ${activity.title}`,
      description: `${daysOverdue} ${daysOverdue === 1 ? 'dia' : 'dias'} de atraso • ${deal ? deal.title : 'Sem deal vinculado'}`,
      reasoning: generateReasoning(activity, daysOverdue, deal),
      dealId: activity.dealId,
      contactId: deal?.contactId,
      activityId: activity.id,
      suggestedAction: primary,
      alternativeActions: alternatives,
      status: 'pending',
      createdAt: nowIso,
      expiresAt: new Date(nowTs + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days
    });

    if (decisions.length >= config.maxDecisionsPerRun) {
      break;
    }
  }

  return {
    analyzerId: config.id,
    analyzerName: config.name,
    decisions,
    metadata: {
      executedAt: nowIso,
      itemsAnalyzed: analyzed,
      decisionsGenerated: decisions.length,
    },
  };
}

export default analyzeOverdueActivities;
