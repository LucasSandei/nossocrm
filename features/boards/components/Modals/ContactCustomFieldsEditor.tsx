import React, { useState } from 'react';

import type { CustomFieldDefinition } from '@/types';
import { toStoredCustomFieldValue } from '@/lib/utils/customFields';
import { cn } from '@/lib/utils/cn';

/**
 * Campos personalizados do contato, editáveis de dentro do card.
 *
 * O formulário classifica a partir das respostas, mas quem conversa com a
 * pessoa descobre o que o formulário não capta. Sem edição aqui, corrigir um
 * grau exigia sair do funil e achar o contato na outra aba — na prática,
 * ninguém corrigia, e o campo virava um palpite congelado.
 *
 * A gravação é por campo, ao sair dele. Não há botão de salvar de propósito:
 * é o mesmo comportamento das etiquetas logo acima, no mesmo card.
 */

interface ContactCustomFieldsEditorProps {
  definitions: CustomFieldDefinition[];
  values: Record<string, string> | undefined;
  /** Recebe o mapa inteiro já mesclado, pronto para gravar. */
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}

const controlClass =
  'w-full rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-2 py-1 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60';

export const ContactCustomFieldsEditor: React.FC<ContactCustomFieldsEditorProps> = ({
  definitions,
  values,
  onChange,
  disabled,
}) => {
  /*
   * Rascunho local só para os campos de digitar. Sem ele, cada tecla passaria
   * pela mutação e o cursor pularia no meio da palavra a cada resposta do
   * servidor. Seletor e data gravam na hora, porque ali não existe meio-termo.
   */
  const [rascunho, setRascunho] = useState<Record<string, string>>({});

  const gravar = (field: CustomFieldDefinition, bruto: string) => {
    const canonico = toStoredCustomFieldValue(bruto, field.type);
    const atual = values?.[field.key] ?? '';
    if (canonico === atual) return;
    onChange({ ...(values ?? {}), [field.key]: canonico });
  };

  const valorNaTela = (field: CustomFieldDefinition) =>
    rascunho[field.key] ?? values?.[field.key] ?? '';

  return (
    <div className="space-y-2">
      {definitions.map((field) => {
        const valor = valorNaTela(field);

        return (
          <div
            key={field.id}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2 text-sm"
          >
            <label
              htmlFor={`cf-${field.id}`}
              className="text-slate-500 dark:text-slate-400 truncate"
              title={field.label}
            >
              {field.label}
            </label>

            {field.type === 'boolean' ? (
              <select
                id={`cf-${field.id}`}
                className={controlClass}
                value={valor}
                disabled={disabled}
                onChange={(e) => gravar(field, e.target.value)}
              >
                {/* Vazio é um estado real: ninguém avaliou ainda. */}
                <option value="">Não informado</option>
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </select>
            ) : field.type === 'select' ? (
              <select
                id={`cf-${field.id}`}
                className={controlClass}
                value={valor}
                disabled={disabled}
                onChange={(e) => gravar(field, e.target.value)}
              >
                <option value="">Não informado</option>
                {(field.options ?? []).map((opcao) => (
                  <option key={opcao} value={opcao}>
                    {opcao}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`cf-${field.id}`}
                className={cn(controlClass, field.type === 'number' && 'tabular-nums')}
                type={
                  field.type === 'date'
                    ? 'date'
                    : field.type === 'number' || field.type === 'currency'
                      ? 'number'
                      : 'text'
                }
                value={valor}
                disabled={disabled}
                placeholder="Não informado"
                onChange={(e) => setRascunho((r) => ({ ...r, [field.key]: e.target.value }))}
                onBlur={(e) => {
                  gravar(field, e.target.value);
                  setRascunho((r) => {
                    const { [field.key]: _, ...resto } = r;
                    return resto;
                  });
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
