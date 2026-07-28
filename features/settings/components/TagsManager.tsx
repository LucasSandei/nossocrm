'use client';

import React, { useState } from 'react';
import { Tag, Plus, Pencil, Check, Trash2, X } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { Button } from '@/components/ui/button';
import { useTagsWithUsage, useCreateTag, useRenameTag, useDeleteTag } from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Gerenciamento amplo do catálogo de etiquetas da organização (`public.tags`).
 *
 * É a mesma origem usada pela aba Contatos e pelo card do board: renomear aqui
 * reflete em todos os contatos que usam a etiqueta, e excluir remove a
 * associação de todos eles (ON DELETE CASCADE em contact_tags).
 */
export const TagsManager: React.FC = () => {
  const { data: tags = [], isLoading } = useTagsWithUsage();
  const createMutation = useCreateTag();
  const renameMutation = useRenameTag();
  const deleteMutation = useDeleteTag();
  const { addToast } = useToast();

  const [newTagName, setNewTagName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; contactCount: number } | null>(null);

  const handleCreate = async () => {
    const name = newTagName.trim();
    if (!name) return;
    try {
      await createMutation.mutateAsync(name);
      addToast(`Etiqueta "${name}" criada.`, 'success');
      setNewTagName('');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Erro ao criar etiqueta.', 'error');
    }
  };

  const startEditing = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleRename = async () => {
    if (!editingId) return;
    const name = editingName.trim();
    if (!name) return;
    try {
      await renameMutation.mutateAsync({ id: editingId, name });
      addToast('Etiqueta renomeada em todos os contatos.', 'success');
      cancelEditing();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Erro ao renomear etiqueta.', 'error');
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMutation.mutateAsync(pendingDelete.id);
      addToast(`Etiqueta "${pendingDelete.name}" removida.`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Erro ao remover etiqueta.', 'error');
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <SettingsSection title="Gerenciamento de Tags" icon={Tag}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
        Catálogo de etiquetas da organização. É a mesma lista usada na aba Contatos e no card do
        negócio: renomear aqui atualiza todos os contatos que usam a etiqueta, e excluir remove a
        etiqueta de todos eles.
      </p>

      <div className="p-4 rounded-xl border bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/5 mb-6">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label htmlFor="new-tag-name" className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Nome da Etiqueta
            </label>
            <input
              id="new-tag-name"
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreate();
                }
              }}
              placeholder="Ex: VIP, Instagram, Base antiga..."
              className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
            />
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={handleCreate}
            disabled={!newTagName.trim() || createMutation.isPending}
          >
            <Plus size={16} /> Adicionar
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {tags.map(tag => (
          <div
            key={tag.id}
            className={`flex items-center justify-between p-3 bg-white dark:bg-white/5 border rounded-lg transition-colors ${
              editingId === tag.id
                ? 'border-amber-400 dark:border-amber-500/50 ring-1 ring-amber-400/30'
                : 'border-slate-200 dark:border-white/10 hover:border-primary-300 dark:hover:border-primary-500/50'
            }`}
          >
            {editingId === tag.id ? (
              <div className="flex items-center gap-2 flex-1 mr-2">
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleRename();
                    }
                    if (e.key === 'Escape') cancelEditing();
                  }}
                  aria-label={`Novo nome para ${tag.name}`}
                  className="flex-1 bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                />
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-slate-100 dark:bg-white/10 flex items-center justify-center text-slate-500 dark:text-slate-400">
                  <Tag size={14} />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{tag.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {tag.contactCount === 1 ? '1 contato' : `${tag.contactCount} contatos`}
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-1">
              {editingId === tag.id ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleRename}
                    disabled={!editingName.trim() || renameMutation.isPending}
                    title="Salvar novo nome"
                    className="text-slate-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                  >
                    <Check size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={cancelEditing}
                    title="Cancelar"
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X size={16} />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => startEditing(tag.id, tag.name)}
                    title="Renomear etiqueta"
                    className="text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                  >
                    <Pencil size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPendingDelete({ id: tag.id, name: tag.name, contactCount: tag.contactCount })}
                    title="Remover etiqueta"
                    className="text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={16} />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}

        {!isLoading && tags.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-4 italic">Nenhuma etiqueta criada.</p>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title={`Remover a etiqueta "${pendingDelete?.name}"?`}
        message={
          pendingDelete && pendingDelete.contactCount > 0
            ? `Ela será removida de ${pendingDelete.contactCount} contato(s). Os contatos permanecem, apenas perdem esta etiqueta. A ação não pode ser desfeita.`
            : 'Esta etiqueta não está aplicada a nenhum contato. A ação não pode ser desfeita.'
        }
        confirmText="Remover"
        variant="danger"
        onConfirm={handleDelete}
      />
    </SettingsSection>
  );
};
