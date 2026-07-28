'use client';

import React, { useState } from 'react';
import { PenTool, Pencil, Check, Plus, Tag, Trash2 } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { CustomFieldType } from '@/types';
import { CUSTOM_FIELD_TYPE_LABELS, CUSTOM_FIELD_TYPE_OPTIONS } from '@/lib/utils/customFields';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/FormField';
import {
  useContactCustomFieldDefinitions,
  useCreateContactCustomFieldDefinition,
  useUpdateContactCustomFieldDefinition,
  useDeleteContactCustomFieldDefinition,
} from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';

function slugifyKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Gerenciador de campos personalizados de CONTATO (separado do de Negócios).
 * Persiste em custom_field_definitions com entity_type = 'contact'.
 */
export const ContactCustomFieldsManager: React.FC = () => {
  const { data: fields = [] } = useContactCustomFieldDefinitions();
  const createMutation = useCreateContactCustomFieldDefinition();
  const updateMutation = useUpdateContactCustomFieldDefinition();
  const deleteMutation = useDeleteContactCustomFieldDefinition();
  const { addToast } = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [optionsText, setOptionsText] = useState('');

  const resetForm = () => {
    setEditingId(null);
    setLabel('');
    setType('text');
    setOptionsText('');
  };

  const handleStartEditing = (fieldId: string) => {
    const field = fields.find(f => f.id === fieldId);
    if (!field) return;
    setEditingId(field.id);
    setLabel(field.label);
    setType(field.type);
    setOptionsText((field.options || []).join(', '));
  };

  const handleSave = async () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) return;
    const options = type === 'select'
      ? optionsText.split(',').map(o => o.trim()).filter(Boolean)
      : undefined;

    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, updates: { label: trimmedLabel, type, options } });
        addToast('Campo personalizado atualizado.', 'success');
      } else {
        await createMutation.mutateAsync({ key: slugifyKey(trimmedLabel), label: trimmedLabel, type, options });
        addToast('Campo personalizado criado.', 'success');
      }
      resetForm();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Erro ao salvar campo personalizado.', 'error');
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      addToast('Campo personalizado removido.', 'success');
      if (editingId === id) resetForm();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Erro ao remover campo personalizado.', 'error');
    }
  };

  return (
    <SettingsSection title="Campos Personalizados de Contato" icon={PenTool}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
        Crie campos específicos para seus contatos (ex: CPF, Canal de Aquisição, Data de Contrato). Eles
        aparecerão na edição do contato, na aba Contatos e no card do negócio vinculado.
      </p>

      <div className={`p-4 rounded-xl border transition-all mb-6 ${editingId ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-500/20' : 'bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/5'}`}>
        {editingId && (
          <div className="flex items-center gap-2 mb-3 text-amber-600 dark:text-amber-400 text-xs font-bold uppercase tracking-wider">
            <Pencil size={12} /> Editando Campo
          </div>
        )}
        <div className="flex gap-3 items-end mb-3">
          <InputField
            label="Nome do Campo"
            containerClassName="flex-1"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex: CPF"
          />
          <SelectField
            label="Tipo"
            id="contact-custom-field-type"
            containerClassName="w-40"
            options={CUSTOM_FIELD_TYPE_OPTIONS}
            value={type}
            onChange={(e) => setType(e.target.value as CustomFieldType)}
          />
          <div className="flex gap-2">
            {editingId && (
              <Button variant="outline" size="sm" onClick={resetForm}>
                Cancelar
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!label.trim() || createMutation.isPending || updateMutation.isPending}
              className={editingId ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20' : undefined}
            >
              {editingId ? <Check size={16} /> : <Plus size={16} />}
              {editingId ? 'Salvar' : 'Criar'}
            </Button>
          </div>
        </div>

        {type === 'select' && (
          <div className="animate-in slide-in-from-top-2 fade-in duration-200">
            <InputField
              label="Opções (Separadas por vírgula)"
              type="text"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder="Ex: Indicação, Instagram, Google"
              hint="Essas opções aparecerão em um menu dropdown na edição do contato."
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        {fields.map(field => (
          <div key={field.id} className={`flex items-center justify-between p-3 bg-white dark:bg-white/5 border rounded-lg group transition-colors ${editingId === field.id ? 'border-amber-400 dark:border-amber-500/50 ring-1 ring-amber-400/30' : 'border-slate-200 dark:border-white/10 hover:border-primary-300 dark:hover:border-primary-500/50'}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-slate-100 dark:bg-white/10 flex items-center justify-center text-slate-500 dark:text-slate-400">
                <Tag size={14} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{field.label}</p>
                <div className="flex items-center gap-2 text-xs text-slate-500 font-mono mt-0.5">
                  <span>{field.key}</span>
                  <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                  <span>{CUSTOM_FIELD_TYPE_LABELS[field.type] || field.type}</span>
                  {field.options && (
                    <>
                      <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                      <span className="text-primary-500">{field.options.length} opções</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleStartEditing(field.id)}
                title="Editar campo"
                className="text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
              >
                <Pencil size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemove(field.id)}
                title="Remover campo"
                className="text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </div>
        ))}
        {fields.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-4 italic">Nenhum campo personalizado de contato criado.</p>
        )}
      </div>
    </SettingsSection>
  );
};
