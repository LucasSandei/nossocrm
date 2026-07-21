'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Tag as TagIcon, Plus, Check } from 'lucide-react';
import { useTags, useBulkAssignContactTags } from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';

interface ContactsBulkTagPopoverProps {
  contactIds: string[];
}

/**
 * Botão + popover para aplicar etiquetas (existentes ou novas) a todos os
 * contatos selecionados na aba Contatos.
 */
export const ContactsBulkTagPopover: React.FC<ContactsBulkTagPopoverProps> = ({ contactIds }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTagNames, setSelectedTagNames] = useState<Set<string>>(new Set());
  const [newTagName, setNewTagName] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  const { data: tags = [] } = useTags();
  const bulkAssignMutation = useBulkAssignContactTags();
  const { addToast } = useToast();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleTag = (name: string) => {
    setSelectedTagNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAddNewTag = () => {
    const name = newTagName.trim();
    if (!name) return;
    setSelectedTagNames(prev => new Set(prev).add(name));
    setNewTagName('');
  };

  const handleApply = async () => {
    if (selectedTagNames.size === 0) return;
    try {
      await bulkAssignMutation.mutateAsync({
        contactIds,
        tagNames: Array.from(selectedTagNames),
      });
      addToast(`Etiqueta(s) aplicada(s) a ${contactIds.length} contato(s).`, 'success');
      setSelectedTagNames(new Set());
      setIsOpen(false);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Erro ao aplicar etiquetas.', 'error');
    }
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="flex items-center gap-2 px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium rounded-lg transition-colors"
      >
        <TagIcon size={14} />
        Adicionar etiqueta
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full mt-2 right-0 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-3 animate-in fade-in slide-in-from-top-2 duration-150">
          <p className="text-xs font-bold text-slate-400 uppercase mb-2">Etiquetas existentes</p>
          <div className="max-h-40 overflow-y-auto space-y-1 mb-3">
            {tags.length === 0 && (
              <p className="text-xs text-slate-400">Nenhuma etiqueta criada ainda.</p>
            )}
            {tags.map(tag => {
              const checked = selectedTagNames.has(tag.name);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.name)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left"
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      checked
                        ? 'bg-primary-600 border-primary-600'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {checked && <Check size={12} className="text-white" />}
                  </span>
                  <span className="text-sm text-slate-700 dark:text-slate-200 truncate">{tag.name}</span>
                </button>
              );
            })}
          </div>

          <p className="text-xs font-bold text-slate-400 uppercase mb-2">Criar nova etiqueta</p>
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddNewTag();
                }
              }}
              placeholder="Ex: novo lead"
              className="flex-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="button"
              onClick={handleAddNewTag}
              disabled={!newTagName.trim()}
              className="p-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40 rounded-lg"
            >
              <Plus size={16} />
            </button>
          </div>

          {selectedTagNames.size > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {Array.from(selectedTagNames).map(name => (
                <span
                  key={name}
                  className="text-xs bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 px-2 py-0.5 rounded-full"
                >
                  {name}
                </span>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleApply}
            disabled={selectedTagNames.size === 0 || bulkAssignMutation.isPending}
            className="w-full bg-primary-600 hover:bg-primary-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-bold py-2 rounded-lg transition-all"
          >
            {bulkAssignMutation.isPending ? 'Aplicando...' : `Aplicar a ${contactIds.length} contato(s)`}
          </button>
        </div>
      )}
    </div>
  );
};
