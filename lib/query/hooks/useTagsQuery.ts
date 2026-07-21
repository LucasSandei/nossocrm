/**
 * TanStack Query hooks for the shared Tags catalog and contact tag assignment.
 */
import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { tagsService, contactTagsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Contact, PaginatedResponse } from '@/types';

/** Lista o catálogo de etiquetas da organização (compartilhado por contatos e negócios). */
export const useTags = () => {
  const { user, loading: authLoading } = useAuth();
  return useQuery({
    queryKey: queryKeys.tags.lists(),
    queryFn: async () => {
      const { data, error } = await tagsService.list();
      if (error) throw error;
      return data;
    },
    staleTime: 60 * 1000,
    enabled: !authLoading && !!user,
  });
};

/**
 * Aplica etiquetas (criando as que não existirem) a vários contatos de uma vez.
 * Usado pela ação em massa da aba Contatos.
 */
export const useBulkAssignContactTags = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ contactIds, tagNames }: { contactIds: string[]; tagNames: string[] }) => {
      const { error } = await contactTagsService.assignTagsToContacts(contactIds, tagNames);
      if (error) throw error;
      return { contactIds, tagNames };
    },
    onSuccess: ({ contactIds, tagNames }) => {
      const contactIdSet = new Set(contactIds);
      const mergeTags = (contact: Contact): Contact => {
        if (!contactIdSet.has(contact.id)) return contact;
        const existing = new Set(contact.tags || []);
        for (const name of tagNames) existing.add(name);
        return { ...contact, tags: Array.from(existing) };
      };

      queryClient.setQueryData<Contact[]>(queryKeys.contacts.lists(), (old = []) => old.map(mergeTags));

      const paginatedQueries = queryClient.getQueriesData<PaginatedResponse<Contact>>({
        queryKey: queryKeys.contacts.all,
      });
      for (const [key, data] of paginatedQueries) {
        if (!Array.isArray(key) || (key as QueryKey)[1] !== 'paginated' || !data) continue;
        queryClient.setQueryData<PaginatedResponse<Contact>>(key, {
          ...data,
          data: data.data.map(mergeTags),
        });
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.tags.lists() });
    },
  });
};
