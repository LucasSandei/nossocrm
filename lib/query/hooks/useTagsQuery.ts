/**
 * TanStack Query hooks for the shared Tags catalog and contact tag assignment.
 */
import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { queryKeys, DEALS_VIEW_KEY } from '../index';
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
 * Catálogo de etiquetas com a contagem de contatos de cada uma.
 * Usado pelo gerenciamento amplo em Configurações.
 */
export const useTagsWithUsage = () => {
  const { user, loading: authLoading } = useAuth();
  return useQuery({
    queryKey: [...queryKeys.tags.lists(), 'usage'] as const,
    queryFn: async () => {
      const { data, error } = await tagsService.listWithUsage();
      if (error) throw error;
      return data;
    },
    staleTime: 30 * 1000,
    enabled: !authLoading && !!user,
  });
};

/**
 * Invalida tudo que depende do catálogo de etiquetas: o próprio catálogo, os
 * contatos (que carregam os nomes) e o board (que espelha as etiquetas do
 * contato no card).
 */
function useInvalidateTagConsumers() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tags.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
    queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
  };
}

/** Cria uma etiqueta no catálogo da organização. */
export const useCreateTag = () => {
  const invalidate = useInvalidateTagConsumers();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await tagsService.create(name);
      if (error) throw error;
      return data!;
    },
    onSuccess: invalidate,
  });
};

/** Renomeia uma etiqueta; o novo nome reflete em todos os contatos que a usam. */
export const useRenameTag = () => {
  const invalidate = useInvalidateTagConsumers();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await tagsService.rename(id, name);
      if (error) throw error;
      return { id, name };
    },
    onSuccess: invalidate,
  });
};

/** Remove a etiqueta do catálogo e, em cascata, de todos os contatos. */
export const useDeleteTag = () => {
  const invalidate = useInvalidateTagConsumers();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tagsService.remove(id);
      if (error) throw error;
      return id;
    },
    onSuccess: invalidate,
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
