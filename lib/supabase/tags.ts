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

function normalizeTagName(name: string): string {
  return name.trim();
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
  /** Retorna um mapa contactId -> nomes de etiquetas, para os IDs informados. */
  async listForContacts(contactIds: string[]): Promise<{ data: Map<string, string[]>; error: Error | null }> {
    const result = new Map<string, string[]>();
    if (!supabase || contactIds.length === 0) return { data: result, error: null };

    const { data, error } = await supabase
      .from('contact_tags')
      .select('contact_id, tags(name)')
      .in('contact_id', contactIds);
    if (error) return { data: result, error };

    for (const row of data || []) {
      const tagName = (row as any).tags?.name as string | undefined;
      if (!tagName) continue;
      const list = result.get(row.contact_id) || [];
      list.push(tagName);
      result.set(row.contact_id, list);
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
