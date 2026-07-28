import { describe, it, expect } from 'vitest';
import {
  CUSTOM_FIELD_TYPE_OPTIONS,
  formatCustomFieldValue,
  inputTypeFor,
  toInputCustomFieldValue,
  toStoredCustomFieldValue,
} from './customFields';

describe('toStoredCustomFieldValue', () => {
  it('normaliza booleano em várias formas de entrada', () => {
    expect(toStoredCustomFieldValue(true, 'boolean')).toBe('true');
    expect(toStoredCustomFieldValue('Sim', 'boolean')).toBe('true');
    expect(toStoredCustomFieldValue('1', 'boolean')).toBe('true');
    expect(toStoredCustomFieldValue(false, 'boolean')).toBe('false');
    expect(toStoredCustomFieldValue('não', 'boolean')).toBe('false');
    expect(toStoredCustomFieldValue('', 'boolean')).toBe('');
  });

  it('aceita vírgula decimal e símbolo de moeda', () => {
    expect(toStoredCustomFieldValue('1997,90', 'currency')).toBe('1997.9');
    expect(toStoredCustomFieldValue('R$ 1.997,90', 'currency')).toBe('1997.9');
    expect(toStoredCustomFieldValue(1997.9, 'currency')).toBe('1997.9');
    expect(toStoredCustomFieldValue('42,5', 'number')).toBe('42.5');
  });

  it('não confunde separador de milhar com decimal', () => {
    expect(toStoredCustomFieldValue('1.997', 'currency')).toBe('1997');
    // Ponto seguido de menos de 3 dígitos é decimal de verdade.
    expect(toStoredCustomFieldValue('19.97', 'currency')).toBe('19.97');
  });

  it('mantém data pura como YYYY-MM-DD', () => {
    expect(toStoredCustomFieldValue('2026-07-27', 'date')).toBe('2026-07-27');
  });

  it('converte data e hora para ISO', () => {
    const stored = toStoredCustomFieldValue('2026-07-27T14:30', 'datetime');
    expect(new Date(stored).toISOString()).toBe(stored);
  });

  it('descarta entrada inaproveitável', () => {
    expect(toStoredCustomFieldValue('abc', 'number')).toBe('');
    expect(toStoredCustomFieldValue('data invalida', 'date')).toBe('');
    expect(toStoredCustomFieldValue(null, 'text')).toBe('');
  });
});

describe('formatCustomFieldValue', () => {
  it('exibe booleano em pt-BR', () => {
    expect(formatCustomFieldValue('true', 'boolean')).toBe('Sim');
    expect(formatCustomFieldValue('false', 'boolean')).toBe('Não');
  });

  it('exibe moeda em real', () => {
    const out = formatCustomFieldValue('1997.9', 'currency') || '';
    expect(out).toContain('1.997,90');
    expect(out).toContain('R$');
  });

  it('exibe data sem cair no dia anterior por fuso', () => {
    expect(formatCustomFieldValue('2026-07-27', 'date')).toBe('27/07/2026');
  });

  it('devolve null quando vazio, para o chamador escolher o placeholder', () => {
    expect(formatCustomFieldValue('', 'text')).toBeNull();
    expect(formatCustomFieldValue(undefined, 'currency')).toBeNull();
  });

  it('não quebra com valor fora do formato canônico', () => {
    expect(formatCustomFieldValue('qualquer coisa', 'currency')).toBe('qualquer coisa');
  });
});

describe('toInputCustomFieldValue', () => {
  it('converte ISO para o formato do input datetime-local', () => {
    const iso = new Date(2026, 6, 27, 14, 30).toISOString();
    expect(toInputCustomFieldValue(iso, 'datetime')).toBe('2026-07-27T14:30');
  });

  it('ida e volta preserva o instante', () => {
    const iso = new Date(2026, 6, 27, 14, 30).toISOString();
    const forInput = toInputCustomFieldValue(iso, 'datetime');
    expect(toStoredCustomFieldValue(forInput, 'datetime')).toBe(iso);
  });
});

describe('inputTypeFor', () => {
  it('mapeia cada tipo para o input HTML correspondente', () => {
    expect(inputTypeFor('currency')).toBe('number');
    expect(inputTypeFor('date')).toBe('date');
    expect(inputTypeFor('datetime')).toBe('datetime-local');
    expect(inputTypeFor('text')).toBe('text');
  });
});

describe('CUSTOM_FIELD_TYPE_OPTIONS', () => {
  it('oferece os seis tipos pedidos mais seleção', () => {
    const values = CUSTOM_FIELD_TYPE_OPTIONS.map(o => o.value);
    expect(values).toEqual(
      expect.arrayContaining(['text', 'number', 'currency', 'date', 'datetime', 'boolean', 'select'])
    );
  });
});
