/**
 * @fileoverview Serviço Supabase para definições de campos personalizados
 * (`custom_field_definitions`), com suporte a múltiplas entidades via
 * `entity_type` ('deal' | 'contact'). Hoje só a UI de Contatos usa este
 * serviço com persistência real — a de Negócios ainda usa localStorage
 * (ver `features/settings/hooks/useSettingsController.ts`).
 *
 * @module lib/supabase/customFields
 */

import { supabase } from './client';
import type { CustomFieldDefinition, CustomFieldType } from '@/types';

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

interface DbCustomFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[] | null;
  entity_type: string;
}

const transform = (db: DbCustomFieldDefinition): CustomFieldDefinition => ({
  id: db.id,
  key: db.key,
  label: db.label,
  type: db.type as CustomFieldType,
  options: db.options || undefined,
  entityType: db.entity_type as CustomFieldDefinition['entityType'],
});

export const customFieldDefinitionsService = {
  async listByEntity(entityType: 'deal' | 'contact'): Promise<{ data: CustomFieldDefinition[]; error: Error | null }> {
    if (!supabase) return { data: [], error: new Error('Supabase não configurado') };
    const { data, error } = await supabase
      .from('custom_field_definitions')
      .select('id, key, label, type, options, entity_type')
      .eq('entity_type', entityType)
      .order('label');
    if (error) return { data: [], error };
    return { data: (data || []).map(transform), error: null };
  },

  async create(
    entityType: 'deal' | 'contact',
    def: { key: string; label: string; type: CustomFieldType; options?: string[] }
  ): Promise<{ data: CustomFieldDefinition | null; error: Error | null }> {
    if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
    const orgId = await getCurrentOrganizationId();
    if (!orgId) return { data: null, error: new Error('Organização não identificada') };

    const { data, error } = await supabase
      .from('custom_field_definitions')
      .insert({
        key: def.key,
        label: def.label,
        type: def.type,
        options: def.options && def.options.length > 0 ? def.options : null,
        entity_type: entityType,
        organization_id: orgId,
      })
      .select('id, key, label, type, options, entity_type')
      .single();
    if (error) return { data: null, error };
    return { data: transform(data), error: null };
  },

  async update(
    id: string,
    updates: { label?: string; type?: CustomFieldType; options?: string[] }
  ): Promise<{ error: Error | null }> {
    if (!supabase) return { error: new Error('Supabase não configurado') };
    const { error } = await supabase
      .from('custom_field_definitions')
      .update({
        ...(updates.label !== undefined ? { label: updates.label } : {}),
        ...(updates.type !== undefined ? { type: updates.type } : {}),
        ...(updates.options !== undefined
          ? { options: updates.options.length > 0 ? updates.options : null }
          : {}),
      })
      .eq('id', id);
    return { error };
  },

  async remove(id: string): Promise<{ error: Error | null }> {
    if (!supabase) return { error: new Error('Supabase não configurado') };
    const { error } = await supabase.from('custom_field_definitions').delete().eq('id', id);
    return { error };
  },
};
