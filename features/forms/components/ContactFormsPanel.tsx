import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  ExternalLink,
  Loader2,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { useContactFormResponses, type FormAnswer, type FormResponse } from '@/lib/query/hooks';

interface ContactFormsPanelProps {
  contactId?: string;
  contactName?: string;
  /** Adia a chamada até a aba abrir, para não custar uma ida ao Forms por card. */
  enabled?: boolean;
}

const DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const STATUS_META: Record<string, { label: string; tone: string }> = {
  completed: {
    label: 'Concluído',
    tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  },
  partial: {
    label: 'Em andamento',
    tone: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  },
  abandoned: {
    label: 'Abandonado',
    tone: 'bg-slate-200 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300',
  },
};

/** Valores chegam do Forms em formatos variados (lista, objeto, data). */
function formatAnswerValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.map(formatAnswerValue).join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const AnswerRow: React.FC<{ answer: FormAnswer }> = ({ answer }) => (
  <div className="py-2 border-b border-slate-100 dark:border-white/5 last:border-0">
    <p className="text-xs text-slate-500 dark:text-slate-400">{answer.question || answer.field_key}</p>
    {answer.is_sensitive ? (
      <p className="mt-0.5 text-sm text-slate-400 dark:text-slate-500 italic flex items-center gap-1.5">
        <Lock size={12} aria-hidden="true" />
        Resposta sensível, omitida por política de dados
      </p>
    ) : (
      <p className="mt-0.5 text-sm text-slate-900 dark:text-white whitespace-pre-wrap break-words">
        {/* `display_value` vem do Forms já com o enunciado da alternativa —
            sem ele, escolha aparece como o código gravado ("a"). */}
        {answer.display_value || formatAnswerValue(answer.value)}
      </p>
    )}
  </div>
);

const ResponseCard: React.FC<{ response: FormResponse; defaultOpen: boolean }> = ({
  response,
  defaultOpen,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const status = STATUS_META[response.status] ?? {
    label: response.status,
    tone: 'bg-slate-200 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300',
  };
  const answers = response.answers ?? [];
  const dateLabel = DATE_FORMATTER.format(new Date(response.completed_at ?? response.started_at));

  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
      >
        <span className="mt-0.5 text-slate-400 shrink-0">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white break-words">
              {response.form.title || 'Formulário sem título'}
            </h4>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${status.tone}`}
            >
              {status.label}
            </span>
            {response.status === 'partial' && (
              <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                {response.completion_percent}% preenchido
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Clock size={12} aria-hidden="true" />
              {dateLabel}
            </span>
            {response.score !== null && (
              <span className="font-semibold text-primary-600 dark:text-primary-400">
                Pontuação: {response.score}
              </span>
            )}
            {response.outcome && <span>Resultado: {response.outcome.title}</span>}
            <span>
              {answers.length} {answers.length === 1 ? 'resposta' : 'respostas'}
            </span>
          </div>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pl-11">
          {answers.length === 0 ? (
            <p className="text-sm text-slate-500 italic">
              Nenhuma pergunta respondida ainda.
            </p>
          ) : (
            <div className="border-t border-slate-100 dark:border-white/5 pt-1">
              {answers.map(answer => (
                <AnswerRow key={answer.block_id} answer={answer} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Formulários respondidos por um contato, lidos ao vivo no LS Forms.
 *
 * O mesmo painel serve o card do negócio e o modal do contato, para que as
 * duas telas nunca divirjam sobre o que o cliente respondeu.
 */
export const ContactFormsPanel: React.FC<ContactFormsPanelProps> = ({
  contactId,
  contactName,
  enabled = true,
}) => {
  const { data, isLoading, isFetching, error, refetch } = useContactFormResponses(contactId, {
    enabled,
  });

  if (!contactId) {
    return (
      <p className="text-sm text-slate-500 italic">
        Vincule um contato ao negócio para ver os formulários respondidos.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        Carregando formulários…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <AlertTriangle size={16} aria-hidden="true" />
          Não foi possível carregar do LS Forms
        </p>
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          {error instanceof Error ? error.message : 'Erro desconhecido.'}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300 hover:underline"
        >
          <RefreshCw size={12} aria-hidden="true" /> Tentar de novo
        </button>
      </div>
    );
  }

  if (data && !data.configured) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 dark:border-white/10 p-8 text-center">
        <ClipboardList size={28} className="mx-auto text-slate-300 dark:text-slate-600" />
        <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">
          LS Forms não conectado
        </p>
        <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
          Um administrador precisa conectar o LS Forms em Configurações → Integrações → LS Forms
          para que as respostas apareçam aqui.
        </p>
        <a
          href="/settings/integracoes#lsforms"
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-primary-600 dark:text-primary-400 hover:underline"
        >
          Abrir configurações <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    );
  }

  const responses = data?.data ?? [];

  if (responses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 dark:border-white/10 p-8 text-center">
        <ClipboardList size={28} className="mx-auto text-slate-300 dark:text-slate-600" />
        <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">
          Nenhum formulário respondido
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {contactName || 'Este contato'} ainda não respondeu nenhum formulário do LS Forms.
        </p>
      </div>
    );
  }

  const concluidos = responses.filter(r => r.status === 'completed').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-700 dark:text-white flex items-center gap-2">
            <ClipboardList size={16} /> Formulários respondidos
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {responses.length} {responses.length === 1 ? 'envio' : 'envios'}
            {concluidos !== responses.length && ` • ${concluidos} concluído(s)`}
            {contactName ? ` • ${contactName}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50 transition-colors"
          title="Recarregar do LS Forms"
        >
          {isFetching ? (
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw size={12} aria-hidden="true" />
          )}
          Atualizar
        </button>
      </div>

      <div className="space-y-3">
        {responses.map((response, index) => (
          <ResponseCard
            key={response.id}
            response={response}
            // O envio mais recente já vem aberto: é o que se quer ler ao abrir
            // a aba, e fechá-lo obrigaria um clique para o caso comum.
            defaultOpen={index === 0}
          />
        ))}
      </div>

      <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
        <CheckCircle2 size={11} aria-hidden="true" />
        Lido ao vivo do LS Forms — inclui respostas em andamento.
      </p>
    </div>
  );
};
