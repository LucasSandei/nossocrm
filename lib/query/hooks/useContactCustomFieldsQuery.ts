/**
 * TanStack Query hooks for contact-scoped custom field DEFINITIONS
 * (custom_field_definitions where entity_type = 'contact').
 *
 * Values themselves live on contacts.custom_fields (JSONB) and are read/written
 * via the regular useContacts / useUpdateContact hooks.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { customFieldDefinitionsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { CustomFieldDefinition, CustomFieldType } from '@/types';

export const useContactCustomFieldDefinitions = () => {
  const { user, loading: authLoading } = useAuth();
  return useQuery({
    queryKey: queryKeys.contactCustomFieldDefinitions.lists(),
    queryFn: async () => {
      const { data, error } = await customFieldDefinitionsService.listByEntity('contact');
      if (error) throw error;
      return data;
    },
    staleTime: 60 * 1000,
    enabled: !authLoading && !!user,
  });
};

export const useCreateContactCustomFieldDefinition = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (def: { key: string; label: string; type: CustomFieldType; options?: string[] }) => {
      const { data, error } = await customFieldDefinitionsService.create('contact', def);
      if (error) throw error;
      return data!;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<CustomFieldDefinition[]>(
        queryKeys.contactCustomFieldDefinitions.lists(),
        (old = []) => [...old, created]
      );
    },
  });
};

export const useUpdateContactCustomFieldDefinition = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: { label?: string; type?: CustomFieldType; options?: string[] };
    }) => {
      const { error } = await customFieldDefinitionsService.update(id, updates);
      if (error) throw error;
      return { id, updates };
    },
    onSuccess: ({ id, updates }) => {
      queryClient.setQueryData<CustomFieldDefinition[]>(
        queryKeys.contactCustomFieldDefinitions.lists(),
        (old = []) => old.map(def => (def.id === id ? { ...def, ...updates } : def))
      );
    },
  });
};

export const useDeleteContactCustomFieldDefinition = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await customFieldDefinitionsService.remove(id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<CustomFieldDefinition[]>(
        queryKeys.contactCustomFieldDefinitions.lists(),
        (old = []) => old.filter(def => def.id !== id)
      );
    },
  });
};
