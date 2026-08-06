import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  FORMS_DEFAULT_BASE_URL,
  fetchFormsCatalog,
  testFormsConnection,
  type FormsCatalogItem,
} from '@/lib/forms/client';

export const runtime = 'nodejs';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Mostra só o prefixo: o suficiente para reconhecer a chave, inútil se vazar. */
function maskKey(key: string | null): string | null {
  if (!key) return null;
  return `${key.slice(0, 12)}${'•'.repeat(8)}`;
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: json({ error: 'Unauthorized' }, 401) } as const;

  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (!me?.organization_id) return { error: json({ error: 'Profile not found' }, 404) } as const;
  if (me.role !== 'admin') return { error: json({ error: 'Somente admin.' }, 403) } as const;

  return { supabase, organizationId: me.organization_id as string } as const;
}

/**
 * Estado da conexão, com o catálogo de formulários quando conectado.
 *
 * A chave nunca volta inteira. O catálogo vem junto para que a tela mostre
 * de imediato quais formulários alimentam o CRM, que é a pergunta que se faz
 * ao olhar essa tela.
 */
export async function GET() {
  const ctx = await requireAdmin();
  if ('error' in ctx) return ctx.error;

  const { data } = await ctx.supabase
    .from('organization_settings')
    .select('forms_api_key, forms_base_url, forms_enabled_ids')
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  const key = (data?.forms_api_key as string | null) || null;
  const baseUrl = (data?.forms_base_url as string | null) || FORMS_DEFAULT_BASE_URL;
  const enabledIds = (data?.forms_enabled_ids as string[] | null) ?? [];

  let forms: FormsCatalogItem[] = [];
  let catalogError: string | null = null;

  if (key) {
    try {
      forms = await fetchFormsCatalog({ apiKey: key, baseUrl, enabledFormIds: enabledIds });
    } catch (e) {
      // O Forms fora do ar não pode impedir a tela de abrir: ela ainda serve
      // para trocar a chave ou desconectar.
      catalogError = e instanceof Error ? e.message : 'Falha ao listar formulários.';
    }
  }

  return json({
    connected: Boolean(key),
    maskedKey: maskKey(key),
    baseUrl,
    defaultBaseUrl: FORMS_DEFAULT_BASE_URL,
    enabledIds,
    forms,
    catalogError,
  });
}

const SaveSchema = z
  .object({
    apiKey: z.string().trim().min(8).max(200),
    baseUrl: z.string().trim().url().max(300).optional().or(z.literal('')),
  })
  .strict();

/**
 * Grava a credencial, mas só depois de provar que ela funciona.
 *
 * Validar antes de gravar evita o estado em que a tela diz "conectado" e todo
 * card de contato mostra erro — o problema aparece aqui, onde há o que fazer
 * a respeito, e não espalhado pelo produto.
 */
export async function POST(request: Request) {
  const ctx = await requireAdmin();
  if ('error' in ctx) return ctx.error;

  const parsed = SaveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Dados inválidos.' }, 400);

  const baseUrl = (parsed.data.baseUrl || FORMS_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const credentials = { apiKey: parsed.data.apiKey, baseUrl, enabledFormIds: [] };

  const test = await testFormsConnection(credentials);
  if (!test.ok) return json({ error: test.error || 'Não foi possível validar a chave.' }, 400);

  const { error } = await ctx.supabase
    .from('organization_settings')
    .update({ forms_api_key: credentials.apiKey, forms_base_url: baseUrl })
    .eq('organization_id', ctx.organizationId);

  if (error) {
    console.error('[api/forms/settings] falha ao gravar:', error.message);
    return json({ error: 'Falha ao salvar a credencial.' }, 500);
  }

  // Devolve o catálogo obtido na validação: a tela já mostra quais
  // formulários passam a alimentar o CRM, sem uma segunda ida ao Forms.
  return json({
    connected: true,
    maskedKey: maskKey(credentials.apiKey),
    baseUrl,
    forms: test.forms ?? [],
  });
}

const SelectionSchema = z
  .object({
    /** Lista vazia = todos os formulários do workspace. */
    enabledIds: z.array(z.string().uuid()).max(200),
  })
  .strict();

/**
 * Grava quais formulários alimentam o CRM.
 *
 * Separado do POST porque trocar a chave e escolher formulários são ações
 * diferentes: mexer na seleção não deve exigir colar a credencial de novo.
 */
export async function PATCH(request: Request) {
  const ctx = await requireAdmin();
  if ('error' in ctx) return ctx.error;

  const parsed = SelectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Seleção inválida.' }, 400);

  const { error } = await ctx.supabase
    .from('organization_settings')
    .update({ forms_enabled_ids: parsed.data.enabledIds })
    .eq('organization_id', ctx.organizationId);

  if (error) {
    console.error('[api/forms/settings] falha ao gravar seleção:', error.message);
    return json({ error: 'Falha ao salvar a seleção.' }, 500);
  }

  return json({ enabledIds: parsed.data.enabledIds });
}

/** Desconecta. */
export async function DELETE() {
  const ctx = await requireAdmin();
  if ('error' in ctx) return ctx.error;

  const { error } = await ctx.supabase
    .from('organization_settings')
    .update({ forms_api_key: null, forms_base_url: null })
    .eq('organization_id', ctx.organizationId);

  if (error) return json({ error: 'Falha ao desconectar.' }, 500);

  return json({ connected: false });
}
