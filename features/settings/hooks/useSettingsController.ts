import { useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { usePersistedState } from '@/hooks/usePersistedState';

// TODO: Migrate tags to Supabase
// For now, using local state as placeholder
/**
 * Hook React `useSettingsController` que encapsula uma lógica reutilizável.
 * @returns {{ defaultRoute: string; setDefaultRoute: Dispatch<SetStateAction<string>>; availableTags: string[]; newTagName: string; setNewTagName: Dispatch<SetStateAction<string>>; handleAddTag: () => void; removeTag: (tag: string) => void; }} Retorna as configurações gerais e o gerenciamento de tags.
 */
export const useSettingsController = () => {
  const { addToast } = useToast();

  // General Settings
  const [defaultRoute, setDefaultRoute] = usePersistedState<string>('crm_default_route', '/boards');

  // Tags State (local - TODO: migrate to Supabase)
  const [availableTags, setAvailableTags] = usePersistedState<string[]>('crm_tags', []);
  const [newTagName, setNewTagName] = useState('');

  // Tags Logic
  const handleAddTag = () => {
    if (newTagName.trim()) {
      setAvailableTags(prev => [...prev, newTagName.trim()]);
      addToast(`Tag "${newTagName}" adicionada!`, 'success');
      setNewTagName('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setAvailableTags(prev => prev.filter(t => t !== tag));
    addToast(`Tag "${tag}" removida.`, 'info');
  };

  return {
    // General Settings
    defaultRoute,
    setDefaultRoute,

    // Tags
    availableTags,
    newTagName,
    setNewTagName,
    handleAddTag,
    removeTag: handleRemoveTag,
  };
};
