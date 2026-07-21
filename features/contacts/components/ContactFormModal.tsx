import React, { useId, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { Contact } from '@/types';
import { DebugFillButton } from '@/components/debug/DebugFillButton';
import { fakeContact } from '@/lib/debug';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';
import { useTags, useContactCustomFieldDefinitions } from '@/lib/query/hooks';

/** Estágios do funil de contatos — mesmo conjunto usado em ContactsStageTabs/StageBadge. */
export const CONTACT_STAGE_OPTIONS = [
  { value: 'LEAD', label: 'Lead' },
  { value: 'MQL', label: 'MQL' },
  { value: 'PROSPECT', label: 'Prospect' },
  { value: 'CUSTOMER', label: 'Cliente' },
  { value: 'OTHER', label: 'Outros / Perdidos' },
] as const;

interface ContactFormData {
  name: string;
  email: string;
  phone: string;
  role: string;
  companyName: string;
  status: Contact['status'];
  stage: string;
  source: NonNullable<Contact['source']> | '';
  birthDate: string;
  notes: string;
  tags: string[];
  customFields: Record<string, string>;
}

interface ContactFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  formData: ContactFormData;
  setFormData: (data: ContactFormData) => void;
  editingContact: Contact | null;
  createFakeContactsBatch?: (count: number) => Promise<void>;
  isSubmitting?: boolean;
}

const LABEL_CLASS = 'block text-xs font-bold text-slate-500 uppercase mb-1';
const INPUT_CLASS = 'w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500';

/**
 * Modal de criação/edição de contato. Expõe todos os campos relevantes da
 * tabela `contacts` (não só os 5 originais), incluindo etiquetas e campos
 * personalizados.
 */
export const ContactFormModal: React.FC<ContactFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  formData,
  setFormData,
  editingContact,
  createFakeContactsBatch,
  isSubmitting = false,
}) => {
  const headingId = useId();
  useFocusReturn({ enabled: isOpen });
  const [isCreatingBatch, setIsCreatingBatch] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const { data: availableTags = [] } = useTags();
  const { data: customFieldDefinitions = [] } = useContactCustomFieldDefinitions();

  if (!isOpen) return null;

  const fillWithFakeData = () => {
    const fake = fakeContact();
    setFormData({
      ...formData,
      name: fake.name,
      email: fake.email,
      phone: fake.phone,
      role: fake.role,
      companyName: fake.companyName,
    });
  };

  const addTag = (raw: string) => {
    const name = raw.trim();
    if (!name || formData.tags.includes(name)) return;
    setFormData({ ...formData, tags: [...formData.tags, name] });
    setTagInput('');
  };

  const removeTag = (name: string) => {
    setFormData({ ...formData, tags: formData.tags.filter(t => t !== name) });
  };

  const setCustomField = (key: string, value: string) => {
    setFormData({ ...formData, customFields: { ...formData.customFields, [key]: value } });
  };

  const tagSuggestions = availableTags
    .map(t => t.name)
    .filter(name => !formData.tags.includes(name) && name.toLowerCase().includes(tagInput.toLowerCase()));

  return (
    <FocusTrap active={isOpen} onEscape={onClose}>
      <div
        className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
          <div className="p-5 border-b border-slate-200 dark:border-white/10 flex justify-between items-center flex-shrink-0">
            <div className="flex items-center gap-2">
              <h2 id={headingId} className="text-lg font-bold text-slate-900 dark:text-white font-display">
                {editingContact ? 'Editar Contato' : 'Novo Contato'}
              </h2>
              <DebugFillButton onClick={fillWithFakeData} />
              {createFakeContactsBatch && (
                <DebugFillButton
                  onClick={async () => {
                    setIsCreatingBatch(true);
                    try {
                      await createFakeContactsBatch(10);
                      onClose();
                    } finally {
                      setIsCreatingBatch(false);
                    }
                  }}
                  label={isCreatingBatch ? 'Criando...' : 'Fake x10'}
                  variant="secondary"
                  className="ml-1"
                  disabled={isCreatingBatch}
                />
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar modal"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-white focus-visible-ring rounded"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label htmlFor="contact-name" className={LABEL_CLASS}>
                  Nome Completo <span aria-hidden="true">*</span>
                </label>
                <input
                  id="contact-name"
                  required
                  aria-required="true"
                  type="text"
                  className={INPUT_CLASS}
                  placeholder="Ex: Ana Souza"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="contact-email" className={LABEL_CLASS}>
                    Email <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="contact-email"
                    required
                    aria-required="true"
                    type="email"
                    className={INPUT_CLASS}
                    placeholder="ana@empresa.com"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="contact-phone" className={LABEL_CLASS}>Telefone</label>
                  <input
                    id="contact-phone"
                    type="text"
                    className={INPUT_CLASS}
                    placeholder="+5511999999999"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="contact-role" className={LABEL_CLASS}>Cargo</label>
                  <input
                    id="contact-role"
                    type="text"
                    className={INPUT_CLASS}
                    placeholder="Gerente"
                    value={formData.role}
                    onChange={e => setFormData({ ...formData, role: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="contact-company" className={LABEL_CLASS}>Empresa</label>
                  <input
                    id="contact-company"
                    type="text"
                    className={INPUT_CLASS}
                    placeholder="Nome da Empresa"
                    value={formData.companyName}
                    onChange={e => setFormData({ ...formData, companyName: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-400 -mt-2">
                {editingContact
                  ? 'Edite para alterar a empresa. Deixe em branco para desvincular.'
                  : 'Se a empresa já existir, o contato será vinculado a ela.'}
              </p>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="contact-status" className={LABEL_CLASS}>Status</label>
                  <select
                    id="contact-status"
                    className={INPUT_CLASS}
                    value={formData.status}
                    onChange={e => setFormData({ ...formData, status: e.target.value as Contact['status'] })}
                  >
                    <option value="ACTIVE">Ativo</option>
                    <option value="INACTIVE">Inativo</option>
                    <option value="CHURNED">Perdido</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="contact-stage" className={LABEL_CLASS}>Estágio</label>
                  <select
                    id="contact-stage"
                    className={INPUT_CLASS}
                    value={formData.stage}
                    onChange={e => setFormData({ ...formData, stage: e.target.value })}
                  >
                    {CONTACT_STAGE_OPTIONS.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="contact-source" className={LABEL_CLASS}>Origem</label>
                  <select
                    id="contact-source"
                    className={INPUT_CLASS}
                    value={formData.source}
                    onChange={e => setFormData({ ...formData, source: e.target.value as ContactFormData['source'] })}
                  >
                    <option value="">Não informado</option>
                    <option value="WEBSITE">Website</option>
                    <option value="LINKEDIN">LinkedIn</option>
                    <option value="REFERRAL">Indicação</option>
                    <option value="MANUAL">Manual</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="contact-birthdate" className={LABEL_CLASS}>Data de Nascimento</label>
                <input
                  id="contact-birthdate"
                  type="date"
                  className={`${INPUT_CLASS} max-w-xs`}
                  value={formData.birthDate}
                  onChange={e => setFormData({ ...formData, birthDate: e.target.value })}
                />
              </div>

              <div>
                <label htmlFor="contact-notes" className={LABEL_CLASS}>Notas</label>
                <textarea
                  id="contact-notes"
                  rows={3}
                  className={INPUT_CLASS}
                  placeholder="Observações gerais sobre o contato"
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>

              {/* Etiquetas */}
              <div>
                <label htmlFor="contact-tags-input" className={LABEL_CLASS}>Etiquetas</label>
                {formData.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {formData.tags.map(tag => (
                      <span
                        key={tag}
                        className="flex items-center gap-1 text-xs bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 px-2 py-0.5 rounded-full"
                      >
                        {tag}
                        <button type="button" onClick={() => removeTag(tag)} aria-label={`Remover etiqueta ${tag}`}>
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <input
                      id="contact-tags-input"
                      type="text"
                      className={INPUT_CLASS}
                      placeholder="Digite e pressione Enter para adicionar"
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTag(tagInput);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => addTag(tagInput)}
                      disabled={!tagInput.trim()}
                      className="p-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40 rounded-lg flex-shrink-0"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  {tagInput.trim() && tagSuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden max-h-32 overflow-y-auto">
                      {tagSuggestions.map(name => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => addTag(name)}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/50"
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Campos Personalizados */}
              {customFieldDefinitions.length > 0 && (
                <div className="pt-3 border-t border-slate-100 dark:border-white/5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">Campos Personalizados</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {customFieldDefinitions.map(field => (
                      <div key={field.id}>
                        <label htmlFor={`custom-field-${field.id}`} className={LABEL_CLASS}>{field.label}</label>
                        {field.type === 'select' ? (
                          <select
                            id={`custom-field-${field.id}`}
                            className={INPUT_CLASS}
                            value={formData.customFields[field.key] || ''}
                            onChange={e => setCustomField(field.key, e.target.value)}
                          >
                            <option value="">Não informado</option>
                            {(field.options || []).map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={`custom-field-${field.id}`}
                            type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                            className={INPUT_CLASS}
                            value={formData.customFields[field.key] || ''}
                            onChange={e => setCustomField(field.key, e.target.value)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 pt-3 border-t border-slate-100 dark:border-white/5 flex-shrink-0">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-primary-600 hover:bg-primary-500 text-white font-bold py-2.5 rounded-lg shadow-lg shadow-primary-600/20 transition-all"
              >
                {isSubmitting ? 'Criando...' : (editingContact ? 'Salvar Alterações' : 'Criar Contato')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </FocusTrap>
  );
};
