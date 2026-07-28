/**
 * @fileoverview Campos personalizados de contato na API pública.
 *
 * Converte os valores recebidos do integrador para o formato canônico de cada
 * tipo definido em Configurações, usando a mesma lógica da interface
 * (`lib/utils/customFields`). Assim um booleano enviado como `true`, um valor
 * monetário como `1997.9` e uma data como `"27/07/2026"` chegam ao banco no
 * mesmo formato que o formulário de contato gravaria.
 *
 * @module lib/public-api/customFields
 */

import { createStaticAdminClient } from '@/lib/supabase/server';
import { toStoredCustomFieldValue } from '@/lib/utils/customFields';
import type { CustomFieldType } from '@/types';

export type IncomingCustomFields = Record<string, string | number | boolean | null>;

export type NormalizeResult =
  | { ok: true; values: Record<string, string> }
  | { ok: false; unknownKeys: string[] };

/**
 * Normaliza `custom_fields` conforme as definições da organização.
 *
 * Chaves sem definição correspondente são rejeitadas em vez de gravadas: um
 * erro de digitação no formulário viraria dado invisível na interface, que é
 * pior de diagnosticar do que uma resposta 422 explícita.
 */
export async function normalizeCustomFields(opts: {
  organizationId: string;
  values: IncomingCustomFields;
}): Promise<NormalizeResult> {
  const keys = Object.keys(opts.values);
  if (keys.length === 0) return { ok: true, values: {} };

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('custom_field_definitions')
    .select('key, type')
    .eq('organization_id', opts.organizationId)
    .eq('entity_type', 'contact');
  if (error) throw error;

  const typeByKey = new Map<string, CustomFieldType>(
    (data || []).map((d: any) => [d.key as string, d.type as CustomFieldType])
  );

  const unknownKeys = keys.filter(k => !typeByKey.has(k));
  if (unknownKeys.length > 0) return { ok: false, unknownKeys };

  const values: Record<string, string> = {};
  for (const key of keys) {
    values[key] = toStoredCustomFieldValue(opts.values[key], typeByKey.get(key)!);
  }
  return { ok: true, values };
}
