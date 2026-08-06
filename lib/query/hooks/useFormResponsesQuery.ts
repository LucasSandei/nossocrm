/**
 * Respostas do LS Forms de um contato, lidas ao vivo.
 *
 * A chamada passa por `/api/forms/responses`, que resolve o contato no
 * servidor e guarda a credencial. O client nunca vê a chave do Forms.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { useAuth } from '@/context/AuthContext';

/** Uma pergunta respondida, com o enunciado para renderizar. */
export interface FormAnswer {
  block_id: string;
  field_key: string;
  question: string;
  type: string;
  value: unknown;
  is_sensitive: boolean;
  answered_at: string;
}

export interface FormResponse {
  id: string;
  status: 'partial' | 'completed' | 'abandoned' | string;
  started_at: string;
  completed_at: string | null;
  last_seen_at: string;
  duration_seconds: number | null;
  score: number | null;
  completion_percent: number;
  crm_contact_id: string | null;
  respondent: { email: string | null; phone: string | null };
  form: { id: string; title: string; type: string };
  answers?: FormAnswer[];
  outcome?: { id: string; title: string } | null;
}

export interface FormResponsesResult {
  /** `false` quando a organização ainda não conectou o LS Forms. */
  configured: boolean;
  data: FormResponse[];
  total: number;
}

/**
 * Busca as respostas de um contato.
 *
 * @param contactId - Contato do CRM. Sem ele a query fica desabilitada.
 * @param enabled - Permite adiar a chamada até a aba abrir, para não custar
 *   uma ida ao Forms toda vez que alguém abre um card.
 */
export const useContactFormResponses = (
  contactId: string | undefined,
  options: { enabled?: boolean } = {},
) => {
  const { user, loading: authLoading } = useAuth();

  return useQuery<FormResponsesResult>({
    queryKey: queryKeys.formResponses.byContact(contactId || ''),
    queryFn: async () => {
      const res = await fetch(
        `/api/forms/responses?contactId=${encodeURIComponent(contactId!)}`,
        { credentials: 'same-origin' },
      );

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(body?.error || 'Falha ao carregar respostas do LS Forms.');
      }

      return {
        configured: body?.configured !== false,
        data: body?.data ?? [],
        total: body?.total ?? 0,
      };
    },
    enabled: !authLoading && !!user && !!contactId && (options.enabled ?? true),
    // Leitura ao vivo, mas sem refazer a chamada a cada troca de aba dentro
    // do mesmo card.
    staleTime: 60 * 1000,
    retry: 1,
  });
};
