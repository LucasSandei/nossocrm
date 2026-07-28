/**
 * @fileoverview Formato canônico e exibição dos campos personalizados.
 *
 * Os valores vivem num JSONB (`contacts.custom_fields`) sempre como string,
 * para que a API pública, o formulário de contato e o card do board gravem e
 * leiam exatamente a mesma coisa. Este módulo concentra as duas conversões:
 *
 * - `toStoredCustomFieldValue`: entrada do usuário/integração -> string canônica
 * - `formatCustomFieldValue`: string canônica -> texto em pt-BR para exibição
 *
 * Formato canônico por tipo:
 * | tipo      | armazenado             | exemplo                  |
 * |-----------|------------------------|--------------------------|
 * | text      | texto livre            | "Rua A, 123"             |
 * | number    | número, ponto decimal  | "42.5"                   |
 * | currency  | número, ponto decimal  | "1997.9"                 |
 * | date      | YYYY-MM-DD             | "2026-07-27"             |
 * | datetime  | ISO 8601               | "2026-07-27T14:30:00Z"   |
 * | boolean   | 'true' ou 'false'      | "true"                   |
 * | select    | uma das opções         | "Instagram"              |
 *
 * @module lib/utils/customFields
 */

import type { CustomFieldType } from '@/types';

const PT_BR_DATE = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });
const PT_BR_DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});
const PT_BR_CURRENCY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const PT_BR_NUMBER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });

/** Rótulos em pt-BR dos tipos, usados nos seletores e listagens. */
export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  datetime: 'Data e hora',
  boolean: 'Lógico (Sim/Não)',
  currency: 'Monetário',
  select: 'Seleção',
};

/** Ordem de exibição nos seletores de tipo. */
export const CUSTOM_FIELD_TYPE_OPTIONS: Array<{ value: CustomFieldType; label: string }> = (
  ['text', 'number', 'currency', 'date', 'datetime', 'boolean', 'select'] as CustomFieldType[]
).map(value => ({ value, label: CUSTOM_FIELD_TYPE_LABELS[value] }));

/** Aceita vírgula como separador decimal e ignora símbolo de moeda/milhar. */
function parseLooseNumber(raw: string): number | null {
  const cleaned = raw
    .replace(/[R$\s ]/gi, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Converte um valor de entrada para a string canônica do tipo.
 * Retorna string vazia quando o valor não é aproveitável (campo em branco).
 */
export function toStoredCustomFieldValue(
  value: unknown,
  type: CustomFieldType
): string {
  if (value === null || value === undefined) return '';

  if (type === 'boolean') {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    const s = String(value).trim().toLowerCase();
    if (!s) return '';
    if (['true', '1', 'sim', 'yes', 'y', 's'].includes(s)) return 'true';
    if (['false', '0', 'nao', 'não', 'no', 'n'].includes(s)) return 'false';
    return '';
  }

  const raw = String(value).trim();
  if (!raw) return '';

  if (type === 'number' || type === 'currency') {
    const n = typeof value === 'number' ? value : parseLooseNumber(raw);
    return n === null ? '' : String(n);
  }

  if (type === 'date') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }

  if (type === 'datetime') {
    // <input type="datetime-local"> entrega "YYYY-MM-DDTHH:mm" (hora local).
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  return raw;
}

/** Texto pronto para exibição em pt-BR. Vazio vira `null` (o chamador decide o placeholder). */
export function formatCustomFieldValue(
  value: string | undefined | null,
  type: CustomFieldType
): string | null {
  const raw = (value ?? '').toString().trim();
  if (!raw) return null;

  switch (type) {
    case 'boolean':
      return raw === 'true' ? 'Sim' : raw === 'false' ? 'Não' : raw;

    case 'currency': {
      const n = parseLooseNumber(raw);
      return n === null ? raw : PT_BR_CURRENCY.format(n);
    }

    case 'number': {
      const n = parseLooseNumber(raw);
      return n === null ? raw : PT_BR_NUMBER.format(n);
    }

    case 'date': {
      // Data pura não tem fuso. Converter para Date e formatar num fuso qualquer
      // desloca o dia (2026-07-27 vira 26/07 em UTC-3), então reordenamos o
      // texto direto, sem passar por Date.
      const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return `${m[3]}/${m[2]}/${m[1]}`;

      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? raw : PT_BR_DATE.format(d);
    }

    case 'datetime': {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? raw : PT_BR_DATE_TIME.format(d);
    }

    default:
      return raw;
  }
}

/**
 * Valor no formato que o `<input>` correspondente espera.
 * `datetime-local` precisa de "YYYY-MM-DDTHH:mm" na hora local, não ISO em UTC.
 */
export function toInputCustomFieldValue(
  value: string | undefined | null,
  type: CustomFieldType
): string {
  const raw = (value ?? '').toString().trim();
  if (!raw) return '';

  if (type === 'datetime') {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  return raw;
}

/** Tipo do `<input>` HTML para cada tipo de campo. */
export function inputTypeFor(type: CustomFieldType): string {
  switch (type) {
    case 'number':
    case 'currency':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime-local';
    default:
      return 'text';
  }
}
