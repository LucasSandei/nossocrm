-- Segunda causa raiz do bug de exclusão de contato (encontrada ao testar a
-- correção anterior contra "Maria Teste" de verdade): contacts.merged_into_id
-- é uma auto-referência sem ON DELETE, criada por 20260208200000_contact_dedup_merge.sql.
-- Quando um contato-alvo de merge é excluído, os contatos-origem ainda
-- apontam para ele via merged_into_id, e a exclusão falha com violação de FK.
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_merged_into_id_fkey;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_merged_into_id_fkey
  FOREIGN KEY (merged_into_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
