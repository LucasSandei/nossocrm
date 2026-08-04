/**
 * Decision Queue System - Types
 * Sistema de fila de decisões proativas para o CRM
 */

// ============================================
// DECISION
// ============================================

export interface Decision {
  id: string;
  
  // Classificação
  type: DecisionType;
  priority: DecisionPriority;
  category: DecisionCategory;
  
  // Contexto
  title: string;
  description: string;
  reasoning: string;  // Por que a AI está sugerindo isso
  
  // Entidades relacionadas
  dealId?: string;
  contactId?: string;
  activityId?: string;
  
  // Ação sugerida
  suggestedAction: SuggestedAction;
  alternativeActions?: SuggestedAction[];
  
  // Estado
  status: DecisionStatus;
  
  // Timestamps
  createdAt: string;
  expiresAt?: string;
  decidedAt?: string;
  snoozeUntil?: string;
  
  // Multi-tenant (futuro)
  tenantId?: string;
  userId?: string;
}

export type DecisionType = 
  | 'stagnant_deal'           // Deal parado há X dias
  | 'hot_lead'                // Lead com alto engagement
  | 'deadline_approaching'     // Proposta/atividade vencendo
  | 'follow_up_due'           // Follow-up programado
  | 'overdue_activity'        // Atividade atrasada
  | 'deal_at_risk'            // Deal com sinais de risco
  | 'unanswered_proposal'     // Proposta sem resposta
  | 'new_lead_assigned'       // Novo lead atribuído
  | 'win_opportunity'         // Oportunidade de fechar
  | 'rescue_opportunity';     // Oportunidade de resgate

export type DecisionPriority = 'critical' | 'high' | 'medium' | 'low';

export type DecisionCategory = 
  | 'follow_up' 
  | 'deadline' 
  | 'opportunity' 
  | 'risk' 
  | 'routine';

export type DecisionStatus = 
  | 'pending' 
  | 'approved' 
  | 'rejected' 
  | 'snoozed' 
  | 'expired';

// ============================================
// SUGGESTED ACTION
// ============================================

export interface SuggestedAction {
  id: string;
  type: ActionType;
  label: string;  // "Agendar Call", "Enviar WhatsApp"
  icon?: string;  // Nome do ícone lucide
  
  // Dados pré-preenchidos
  payload: ActionPayload;
  
  // Preview (o que o usuário verá antes de aprovar)
  preview?: ActionPreview;
  
  // Configuração
  requiresConfirmation: boolean;
  allowEdit: boolean;
}

export type ActionType = 
  | 'create_activity'
  | 'send_message'
  | 'move_deal'
  | 'schedule_call'
  | 'schedule_meeting'
  | 'update_deal'
  | 'create_task'
  | 'dismiss';

export interface ActionPayload {
  // Para create_activity / schedule_call / schedule_meeting
  activityType?: 'CALL' | 'MEETING' | 'EMAIL' | 'TASK' | 'MESSAGE';
  activityTitle?: string;
  activityDate?: string;
  activityDescription?: string;
  
  // Para send_message
  channel?: 'whatsapp' | 'email' | 'sms';
  recipient?: string;
  recipientName?: string;
  messageTemplate?: string;
  
  // Para move_deal
  newStage?: string;
  
  // Para update_deal
  dealUpdates?: Record<string, unknown>;
  
  // IDs relacionados
  dealId?: string;
  contactId?: string;
}

export interface ActionPreview {
  title?: string;
  message?: string;
  recipient?: string;
  scheduledFor?: string;
  value?: number;
}

// ============================================
// ANALYZER
// ============================================

export interface AnalyzerConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  
  // Parâmetros específicos
  params: Record<string, unknown>;
  
  // Limites
  maxDecisionsPerRun: number;
  cooldownDays?: number;  // Não gerar decisão repetida por X dias
}

export interface AnalyzerResult {
  analyzerId: string;
  analyzerName: string;
  decisions: Decision[];
  metadata: {
    executedAt: string;
    itemsAnalyzed: number;
    decisionsGenerated: number;
    errors?: string[];
  };
}

// ============================================
// DECISION QUEUE SERVICE
// ============================================

export interface DecisionQueueState {
  decisions: Decision[];
  lastAnalyzedAt?: string;
  analyzerResults: AnalyzerResult[];
}

export interface DecisionStats {
  total: number;
  pending: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  byCategory: Record<DecisionCategory, number>;
  byType: Record<DecisionType, number>;
}

// ============================================
// UI PROPS
// ============================================

export interface DecisionCardProps {
  decision: Decision;
  onApprove: (id: string, modifications?: Partial<ActionPayload>) => void;
  onReject: (id: string, reason?: string) => void;
  onSnooze: (id: string, until: Date) => void;
  onSelectAlternative: (id: string, action: SuggestedAction) => void;
  isExecuting?: boolean;
}

export interface DecisionQueueViewProps {
  decisions: Decision[];
  stats: DecisionStats;
  onApprove: (id: string, modifications?: Partial<ActionPayload>) => void;
  onReject: (id: string, reason?: string) => void;
  onSnooze: (id: string, until: Date) => void;
  onApproveAll: () => void;
  onRunAnalyzers: () => void;
  isAnalyzing?: boolean;
}

// ============================================
// HELPER TYPES
// ============================================

export const PRIORITY_ORDER: Record<DecisionPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const PRIORITY_COLORS: Record<DecisionPriority, string> = {
  critical: 'red',
  high: 'orange',
  medium: 'yellow',
  low: 'slate',
};

export const PRIORITY_LABELS: Record<DecisionPriority, string> = {
  critical: 'Crítico',
  high: 'Importante',
  medium: 'Moderado',
  low: 'Baixo',
};

export const CATEGORY_LABELS: Record<DecisionCategory, string> = {
  follow_up: 'Follow-up',
  deadline: 'Prazo',
  opportunity: 'Oportunidade',
  risk: 'Risco',
  routine: 'Rotina',
};

export const TYPE_LABELS: Record<DecisionType, string> = {
  stagnant_deal: 'Deal Parado',
  hot_lead: 'Lead Quente',
  deadline_approaching: 'Prazo Próximo',
  follow_up_due: 'Follow-up Pendente',
  overdue_activity: 'Atividade Atrasada',
  deal_at_risk: 'Deal em Risco',
  unanswered_proposal: 'Proposta sem Resposta',
  new_lead_assigned: 'Novo Lead',
  win_opportunity: 'Oportunidade de Fechar',
  rescue_opportunity: 'Oportunidade de Resgate',
};
