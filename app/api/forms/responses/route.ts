import { createClient } from '@/lib/supabase/server';
import {
  FormsNotConfiguredError,
  FormsRequestError,
  fetchContactResponses,
  getFormsCredentials,
} from '@/lib/forms/client';

export const runtime = 'nodejs';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * GET /api/forms/responses?contactId=...
 *
 * Respostas de formulário de um contato, buscadas ao vivo no LS Forms.
 *
 * O contato é resolvido aqui, no servidor, e não recebido do client: assim o
 * e-mail e o telefone usados na busca são comprovadamente os do contato da
 * organização de quem pediu. Aceitar identificador vindo da tela deixaria
 * qualquer pessoa autenticada consultar as respostas de terceiros informando
 * um e-mail qualquer.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: me } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single();

  if (!me?.organization_id) return json({ error: 'Profile not found' }, 404);

  const url = new URL(request.url);
  const contactId = (url.searchParams.get('contactId') || '').trim();

  if (!contactId) return json({ error: 'Informe contactId.' }, 400);

  // Defense-in-depth: filtra por organization_id além do RLS.
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, email, phone')
    .eq('id', contactId)
    .eq('organization_id', me.organization_id)
    .maybeSingle();

  if (!contact) return json({ error: 'Contato não encontrado.' }, 404);

  let credentials;
  try {
    credentials = await getFormsCredentials(supabase, me.organization_id);
  } catch (e) {
    if (e instanceof FormsNotConfiguredError) {
      // 200 com `configured: false` — a tela mostra o convite para conectar,
      // e não uma mensagem de erro para algo que simplesmente não foi ligado.
      return json({ configured: false, data: [], total: 0 });
    }
    throw e;
  }

  try {
    const result = await fetchContactResponses(
      credentials,
      { crmContactId: contact.id, email: contact.email, phone: contact.phone },
      { expand: url.searchParams.get('expand') !== 'false' },
    );

    return json({ configured: true, ...result });
  } catch (e) {
    if (e instanceof FormsRequestError) {
      return json({ configured: true, error: e.message }, e.status === 401 ? 502 : e.status);
    }
    console.error('[api/forms/responses] erro inesperado:', e);
    return json({ error: 'Falha ao consultar o LS Forms.' }, 500);
  }
}
