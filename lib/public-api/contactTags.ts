/**
 * @fileoverview Etiquetas de contato para a API pública (service role).
 *
 * O catálogo `public.tags` é compartilhado pela organização e a associação com
 * contatos vive em `contact_tags`. O serviço do browser (`lib/supabase/tags`)
 * usa o client autenticado por cookie; aqui a API pública precisa do client
 * service role, então a lógica é reimplementada com filtro explícito por
 * `organization_id` (defense-in-depth, já que service role ignora RLS).
 *
 * @module lib/public-api/contactTags
 */

import { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

/** Limites do PostgREST: teto de linhas por resposta e tamanho da querystring. */
const ROW_PAGE_SIZE = 1000;
const ID_CHUNK_SIZE = 200;

function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Nomes limpos, sem vazios e sem duplicatas (case-insensitive). */
export function normalizeTagNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = normalizeTagName(String(raw ?? ''));
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/**
 * Resolve nomes de etiqueta para IDs do catálogo da organização, criando as
 * que ainda não existirem. A comparação por nome é case-insensitive, então
 * "instagram" e "Instagram" não viram duas etiquetas.
 */
async function resolveTagIds(
  sb: AdminClient,
  organizationId: string,
  names: string[]
): Promise<string[]> {
  const cleanNames = normalizeTagNames(names);
  if (cleanNames.length === 0) return [];

  const { data: existing, error } = await sb
    .from('tags')
    .select('id, name')
    .eq('organization_id', organizationId);
  if (error) throw error;

  const idByLowerName = new Map<string, string>(
    (existing || []).map((t: any) => [String(t.name).toLowerCase(), t.id as string])
  );

  const missing = cleanNames.filter(n => !idByLowerName.has(n.toLowerCase()));
  if (missing.length > 0) {
    const { data: created, error: createError } = await sb
      .from('tags')
      .upsert(
        missing.map(name => ({ name, organization_id: organizationId })),
        { onConflict: 'name,organization_id', ignoreDuplicates: true }
      )
      .select('id, name');
    if (createError) throw createError;

    for (const t of created || []) {
      idByLowerName.set(String((t as any).name).toLowerCase(), (t as any).id as string);
    }

    // `ignoreDuplicates` não retorna as linhas que já existiam por corrida;
    // relê o que ficou faltando para não perder associação.
    const stillMissing = cleanNames.filter(n => !idByLowerName.has(n.toLowerCase()));
    if (stillMissing.length > 0) {
      const { data: refetched, error: refetchError } = await sb
        .from('tags')
        .select('id, name')
        .eq('organization_id', organizationId);
      if (refetchError) throw refetchError;
      for (const t of refetched || []) {
        idByLowerName.set(String((t as any).name).toLowerCase(), (t as any).id as string);
      }
    }
  }

  return cleanNames
    .map(n => idByLowerName.get(n.toLowerCase()))
    .filter((id): id is string => !!id);
}

/**
 * Adiciona etiquetas a um contato sem remover as existentes.
 *
 * É a semântica segura para formulários externos: o formulário marca a origem
 * do lead sem apagar o que o time classificou manualmente.
 */
export async function addContactTags(opts: {
  organizationId: string;
  contactId: string;
  tagNames: string[];
}): Promise<void> {
  const sb = createStaticAdminClient();
  const tagIds = await resolveTagIds(sb, opts.organizationId, opts.tagNames);
  if (tagIds.length === 0) return;

  const { error } = await sb.from('contact_tags').upsert(
    tagIds.map(tagId => ({
      contact_id: opts.contactId,
      tag_id: tagId,
      organization_id: opts.organizationId,
    })),
    { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
  );
  if (error) throw error;
}

/**
 * Substitui por completo as etiquetas de um contato pela lista informada.
 * Lista vazia remove todas.
 */
export async function setContactTags(opts: {
  organizationId: string;
  contactId: string;
  tagNames: string[];
}): Promise<void> {
  const sb = createStaticAdminClient();
  const tagIds = await resolveTagIds(sb, opts.organizationId, opts.tagNames);

  const { error: deleteError } = await sb
    .from('contact_tags')
    .delete()
    .eq('contact_id', opts.contactId)
    .eq('organization_id', opts.organizationId);
  if (deleteError) throw deleteError;

  if (tagIds.length === 0) return;

  const { error } = await sb.from('contact_tags').insert(
    tagIds.map(tagId => ({
      contact_id: opts.contactId,
      tag_id: tagId,
      organization_id: opts.organizationId,
    }))
  );
  if (error) throw error;
}

/**
 * Mapa contactId -> nomes de etiquetas, em lotes de IDs e com paginação de
 * linhas (o PostgREST corta a resposta em 1000 linhas).
 */
export async function listTagsForContacts(opts: {
  organizationId: string;
  contactIds: string[];
}): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const uniqueIds = Array.from(new Set(opts.contactIds.filter(Boolean)));
  if (uniqueIds.length === 0) return result;

  const sb = createStaticAdminClient();

  for (let i = 0; i < uniqueIds.length; i += ID_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + ID_CHUNK_SIZE);
    let offset = 0;

    while (true) {
      const { data, error } = await sb
        .from('contact_tags')
        .select('contact_id, tags(name)')
        .eq('organization_id', opts.organizationId)
        .in('contact_id', chunk)
        .order('contact_id', { ascending: true })
        .order('tag_id', { ascending: true })
        .range(offset, offset + ROW_PAGE_SIZE - 1);
      if (error) throw error;

      const rows = data || [];
      for (const row of rows) {
        const tagName = (row as any).tags?.name as string | undefined;
        if (!tagName) continue;
        const list = result.get((row as any).contact_id) || [];
        list.push(tagName);
        result.set((row as any).contact_id, list);
      }

      if (rows.length < ROW_PAGE_SIZE) break;
      offset += ROW_PAGE_SIZE;
    }
  }

  return result;
}
