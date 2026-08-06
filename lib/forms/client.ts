import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente da API do LS Forms.
 *
 * Fica em `server-only` por desenho: a chave `lsf_` dá leitura a todas as
 * respostas do workspace, então ela nunca pode alcançar o navegador. As telas
 * do CRM falam com `/api/forms/*`, que fala com o Forms.
 *
 * @module lib/forms/client
 */

export const FORMS_DEFAULT_BASE_URL = 'https://forms.lucassandei.com.br/api/v1';

/** Teto de espera. Um Forms lento não pode travar a abertura do card. */
const TIMEOUT_MS = Number(process.env.LS_FORMS_TIMEOUT_MS ?? 8000);

export interface FormsCredentials {
  apiKey: string;
  baseUrl: string;
  /**
   * Formulários habilitados. Vazio significa "todos" — é o estado logo após
   * conectar, e obrigar a escolher ali faria a integração parecer quebrada.
   */
  enabledFormIds: string[];
}

/** Um formulário do workspace, para a tela de seleção. */
export interface FormsCatalogItem {
  id: string;
  title: string;
  type: string;
  status: string;
  updated_at: string;
}

/** Uma pergunta respondida, já com o enunciado para renderizar. */
export interface FormsAnswer {
  block_id: string;
  field_key: string;
  question: string;
  type: string;
  value: unknown;
  is_sensitive: boolean;
  answered_at: string;
}

export interface FormsResponse {
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
  answers?: FormsAnswer[];
  outcome?: { id: string; title: string } | null;
}

export type FormsLookup = {
  crmContactId?: string | null;
  email?: string | null;
  phone?: string | null;
};

export class FormsNotConfiguredError extends Error {
  constructor() {
    super('Integração com o LS Forms não configurada.');
    this.name = 'FormsNotConfiguredError';
  }
}

export class FormsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'FormsRequestError';
  }
}

/**
 * Lê as credenciais da organização.
 *
 * @throws {FormsNotConfiguredError} Quando a organização ainda não conectou.
 */
export async function getFormsCredentials(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<FormsCredentials> {
  const { data } = await supabase
    .from('organization_settings')
    .select('forms_api_key, forms_base_url, forms_enabled_ids')
    .eq('organization_id', organizationId)
    .maybeSingle();

  const apiKey = (data?.forms_api_key as string | null)?.trim();
  if (!apiKey) throw new FormsNotConfiguredError();

  const baseUrl = ((data?.forms_base_url as string | null)?.trim() || FORMS_DEFAULT_BASE_URL)
    .replace(/\/+$/, '');

  return {
    apiKey,
    baseUrl,
    enabledFormIds: (data?.forms_enabled_ids as string[] | null) ?? [],
  };
}

async function call(
  credentials: FormsCredentials,
  path: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${credentials.baseUrl}${path}`, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
      // Respostas mudam a qualquer momento; o valor da leitura ao vivo é
      // justamente não servir uma versão velha.
      cache: 'no-store',
    });

    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!res.ok) {
      const detail = (body as { error?: string } | null)?.error;
      throw new FormsRequestError(
        res.status === 401
          ? 'Chave do LS Forms inválida ou revogada.'
          : detail || `LS Forms respondeu ${res.status}.`,
        res.status,
      );
    }

    return body;
  } catch (e) {
    if (e instanceof FormsRequestError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new FormsRequestError('O LS Forms demorou demais para responder.', 504);
    }
    throw new FormsRequestError(
      e instanceof Error ? e.message : 'Falha ao falar com o LS Forms.',
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Respostas de um contato, em todos os formulários do workspace.
 *
 * Sem identificador nenhum devolve lista vazia em vez de chamar o Forms: a
 * rota de lá recusaria com 400, e um contato sem e-mail nem telefone é caso
 * comum, não erro que mereça mensagem na tela.
 */
export async function fetchContactResponses(
  credentials: FormsCredentials,
  lookup: FormsLookup,
  options: { expand?: boolean; limit?: number } = {},
): Promise<{ data: FormsResponse[]; total: number }> {
  const params = new URLSearchParams();
  if (lookup.crmContactId) params.set('crm_contact_id', lookup.crmContactId);
  if (lookup.email) params.set('email', lookup.email);
  if (lookup.phone) params.set('phone', lookup.phone);

  if ([...params.keys()].length === 0) return { data: [], total: 0 };

  // Seleção vazia é "todos": o parâmetro só vai quando há recorte de verdade.
  if (credentials.enabledFormIds.length > 0) {
    params.set('form_ids', credentials.enabledFormIds.join(','));
  }

  if (options.expand) params.set('expand', 'answers');
  params.set('limit', String(options.limit ?? 25));

  const body = (await call(credentials, `/responses?${params.toString()}`)) as {
    data?: FormsResponse[];
    total?: number;
  } | null;

  return { data: body?.data ?? [], total: body?.total ?? 0 };
}

/**
 * Formulários do workspace, para a tela de seleção.
 *
 * Buscado ao vivo em vez de guardado no CRM: um formulário criado hoje no
 * Forms precisa aparecer aqui sem ninguém sincronizar nada, e um renomeado
 * não pode continuar exibindo o título velho.
 */
export async function fetchFormsCatalog(
  credentials: FormsCredentials,
): Promise<FormsCatalogItem[]> {
  const body = (await call(credentials, '/forms?limit=100')) as {
    data?: FormsCatalogItem[];
  } | null;

  return body?.data ?? [];
}

/** Valida a credencial pedindo uma busca vazia — barata e sem efeito. */
export async function testFormsConnection(
  credentials: FormsCredentials,
): Promise<{ ok: boolean; error?: string; forms?: FormsCatalogItem[] }> {
  try {
    // Listar formulários valida a chave e já entrega o catálogo para a tela
    // de seleção, numa ida só.
    const forms = await fetchFormsCatalog(credentials);
    return { ok: true, forms };
  } catch (e) {
    if (e instanceof FormsRequestError) return { ok: false, error: e.message };
    return { ok: false, error: 'Falha ao conectar no LS Forms.' };
  }
}
