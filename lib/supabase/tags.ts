/**
 * @fileoverview Serviço Supabase para o catálogo de etiquetas (tags) e sua
 * associação com contatos (contact_tags).
 *
 * O catálogo `public.tags` é compartilhado pela organização; contatos usam
 * uma junction table (`contact_tags`) em vez de array, para permitir criar
 * uma etiqueta nova a partir de qualquer tela sem duplicar nomes.
 *
 * @module lib/supabase/tags
 */

import { supabase } from './client';
import type { Tag } from '@/types';

async function getCurrentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  return (profile as any)?.organization_id ?? null;
}

/**
 * Mesma normalização usada no card do board e na API pública: sem espaços nas
 * pontas e sem espaços repetidos no meio, para "Base  antiga" e "Base antiga"
 * não virarem duas etiquetas diferentes no catálogo.
 */
function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export const tagsService = {
  /** Lista todas as etiquetas do catálogo da organização. */
  async list(): Promise<{ data: Tag[]; error: Error | null }> {
    if (!supabase) return { data: [], error: new Error('Supabase não configurado') };
    const { data, error } = await supabase
      .from('tags')
      .select('id, name, color')
      .order('name');
    if (error) return { data: [], error };
    return { data: (data || []).map(t => ({ id: t.id, name: t.name, color: t.color || undefined })), error: null };
  },

  /**
   * Lista as etiquetas com a quantidade de contatos de cada uma.
   *
   * A contagem vem paginada porque `contact_tags` pode passar do teto de 1000
   * linhas por resposta do PostgREST.
   */
  async listWithUsage(): Promise<{ data: Array<Tag & { contactCount: number }>; error: Error | null }> {
    if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

    const { data: tags, error } = await tagsService.list();
    if (error) return { data: [], error };

    const counts = new Map<string, number>();
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
      const { data, error: countError } = await supabase
        .from('contact_tags')
        .select('tag_id')
        .order('contact_id', { ascending: true })
        .order('tag_id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (countError) return { data: [], error: countError };

      const rows = data || [];
      for (const row of rows) counts.set(row.tag_id, (counts.get(row.tag_id) || 0) + 1);

      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    return {
      data: tags.map(t => ({ ...t, contactCount: counts.get(t.id) || 0 })),
      error: null,
    };
  },

  /** Cria uma etiqueta no catálogo. Nome duplicado (case-insensitive) é rejeitado. */
  async create(name: string): Promise<{ data: Tag | null; error: Error | null }> {
    if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
    const cleanName = normalizeTagName(name);
    if (!cleanName) return { data: null, error: new Error('Nome da etiqueta é obrigatório') };

    const orgId = await getCurrentOrganizationId();
    if (!orgId) return { data: null, error: new Error('Organização não identificada') };

    const { data: existing, error: fetchError } = await supabase
      .from('tags')
      .select('id, name')
      .eq('organization_id', orgId);
    if (fetchError) return { data: null, error: fetchError };

    const duplicate = (existing || []).find(
      t => t.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      return { data: null, error: new Error(`A etiqueta "${duplicate.name}" já existe.`) };
    }

    const { data, error } = await supabase
      .from('tags')
      .insert({ name: cleanName, organization_id: orgId })
      .select('id, name, color')
      .single();
    if (error) return { data: null, error };
    return { data: { id: data.id, name: data.name, color: data.color || undefined }, error: null };
  },

  /**
   * Renomeia uma etiqueta. Como contatos apontam para o id, o novo nome
   * aparece automaticamente em todos eles.
   */
  async rename(id: string, name: string): Promise<{ error: Error | null }> {
    if (!supabase) return { error: new Error('Supabase não configurado') };
    const cleanName = normalizeTagName(name);
    if (!cleanName) return { error: new Error('Nome da etiqueta é obrigatório') };

    const orgId = await getCurrentOrganizationId();
    if (!orgId) return { error: new Error('Organização não identificada') };

    const { data: existing, error: fetchError } = await supabase
      .from('tags')
      .select('id, name')
      .eq('organization_id', orgId);
    if (fetchError) return { error: fetchError };

    const duplicate = (existing || []).find(
      t => t.id !== id && t.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      return { error: new Error(`A etiqueta "${duplicate.name}" já existe.`) };
    }

    const { error } = await supabase.from('tags').update({ name: cleanName }).eq('id', id);
    return { error };
  },

  /**
   * Remove a etiqueta do catálogo. As associações em `contact_tags` somem
   * junto por ON DELETE CASCADE.
   */
  async remove(id: string): Promise<{ error: Error | null }> {
    if (!supabase) return { error: new Error('Supabase não configurado') };
    const { error } = await supabase.from('tags').delete().eq('id', id);
    return { error };
  },

  /**
   * Resolve uma lista de nomes de etiqueta para Tags existentes, criando as que
   * ainda não existem no catálogo da organização. Case-insensitive por nome.
   */
  async getOrCreateByNames(names: string[]): Promise<{ data: Tag[]; error: Error | null }> {
    if (!supabase) return { data: [], error: new Error('Supabase não configurado') };
    const cleanNames = Array.from(new Set(names.map(normalizeTagName).filter(Boolean)));
    if (cleanNames.length === 0) return { data: [], error: null };

    const orgId = await getCurrentOrganizationId();
    if (!orgId) return { data: [], error: new Error('Organização não identificada') };

    const { data: existing, error: fetchError } = await supabase
      .from('tags')
      .select('id, name, color')
      .eq('organization_id', orgId);
    if (fetchError) return { data: [], error: fetchError };

    const existingByLowerName = new Map((existing || []).map(t => [t.name.toLowerCase(), t]));
    const missingNames = cleanNames.filter(n => !existingByLowerName.has(n.toLowerCase()));

    if (missingNames.length > 0) {
      const { data: created, error: createError } = await supabase
        .from('tags')
        .upsert(
          missingNames.map(name => ({ name, organization_id: orgId })),
          { onConflict: 'name,organization_id', ignoreDuplicates: true }
        )
        .select('id, name, color');
      if (createError) return { data: [], error: createError };
      for (const t of created || []) existingByLowerName.set(t.name.toLowerCase(), t);
    }

    const result = cleanNames
      .map(n => existingByLowerName.get(n.toLowerCase()))
      .filter((t): t is { id: string; name: string; color: string | null } => !!t)
      .map(t => ({ id: t.id, name: t.name, color: t.color || undefined }));

    return { data: result, error: null };
  },
};

export const contactTagsService = {
  /**
   * Retorna um mapa contactId -> nomes de etiquetas, para os IDs informados.
   *
   * Busca em lotes de IDs e pagina as linhas: o PostgREST devolve no máximo
   * 1000 linhas por resposta e a querystring do `in(...)` tem limite de
   * tamanho. Sem isso, telas que resolvem muitos contatos de uma vez (Boards)
   * recebiam parte dos contatos sem etiqueta alguma.
   */
  async listForContacts(contactIds: string[]): Promise<{ data: Map<string, string[]>; error: Error | null }> {
    const result = new Map<string, string[]>();
    if (!supabase || contactIds.length === 0) return { data: result, error: null };

    const uniqueIds = Array.from(new Set(contactIds.filter(Boolean)));
    if (uniqueIds.length === 0) return { data: result, error: null };

    const ID_CHUNK_SIZE = 200;
    const ROW_PAGE_SIZE = 1000;

    for (let i = 0; i < uniqueIds.length; i += ID_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + ID_CHUNK_SIZE);
      let offset = 0;

      while (true) {
        const { data, error } = await supabase
          .from('contact_tags')
          .select('contact_id, tags(name)')
          .in('contact_id', chunk)
          .order('contact_id', { ascending: true })
          .order('tag_id', { ascending: true })
          .range(offset, offset + ROW_PAGE_SIZE - 1);
        if (error) return { data: result, error };

        const rows = data || [];
        for (const row of rows) {
          const tagName = (row as any).tags?.name as string | undefined;
          if (!tagName) continue;
          const list = result.get(row.contact_id) || [];
          list.push(tagName);
          result.set(row.contact_id, list);
        }

        if (rows.length < ROW_PAGE_SIZE) break;
        offset += ROW_PAGE_SIZE;
      }
    }

    return { data: result, error: null };
  },

  /** Substitui completamente as etiquetas de UM contato (usado pelo modal de edição). */
  async setContactTags(contactId: string, tagNames: string[]): Promise<{ error: Error | null }> {
    if (!supabase) return { error: new Error('Supabase não configurado') };
    const orgId = await getCurrentOrganizationId();
    if (!orgId) return { error: new Error('Organização não identificada') };

    const { data: tags, error: tagError } = await tagsService.getOrCreateByNames(tagNames);
    if (tagError) return { error: tagError };

    const { error: deleteError } = await supabase.from('contact_tags').delete().eq('contact_id', contactId);
    if (deleteError) return { error: deleteError };

    if (tags.length === 0) return { error: null };

    const { error: insertError } = await supabase.from('contact_tags').insert(
      tags.map(t => ({ contact_id: contactId, tag_id: t.id, organization_id: orgId }))
    );
    return { error: insertError };
  },

  /**
   * Aplica (adiciona, sem remover as existentes) uma lista de etiquetas a
   * vários contatos de uma vez — usado pela ação em massa da aba Contatos e
   * pela importação de CSV. Cria etiquetas que ainda não existirem.
   */
  async assignTagsToContacts(
    contactIds: string[],
    tagNames: string[]
  ): Promise<{ error: Error | null }> {
    if (!supabase) return { error: new Error('Supabase não configurado') };
    if (contactIds.length === 0 || tagNames.length === 0) return { error: null };

    const orgId = await getCurrentOrganizationId();
    if (!orgId) return { error: new Error('Organização não identificada') };

    const { data: tags, error: tagError } = await tagsService.getOrCreateByNames(tagNames);
    if (tagError) return { error: tagError };
    if (tags.length === 0) return { error: null };

    const rows = contactIds.flatMap(contactId =>
      tags.map(tag => ({ contact_id: contactId, tag_id: tag.id, organization_id: orgId }))
    );

    // Em lotes: "selecionar todos" numa base grande pode gerar milhares de
    // linhas de uma vez (contatos x etiquetas).
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      // ignoreDuplicates evita erro de PK duplicada quando o contato já tem a etiqueta.
      const { error } = await supabase
        .from('contact_tags')
        .upsert(chunk, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true });
      if (error) return { error };
    }
    return { error: null };
  },

  /** Remove uma etiqueta específica de um contato. */
  async removeTagFromContact(contactId: string, tagId: string): Promise<{ error: Error | null }> {
    if (!supabase) return { error: new Error('Supabase não configurado') };
    const { error } = await supabase
      .from('contact_tags')
      .delete()
      .eq('contact_id', contactId)
      .eq('tag_id', tagId);
    return { error };
  },
};
