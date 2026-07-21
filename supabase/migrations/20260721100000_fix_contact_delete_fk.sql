-- Fix: exclusão de contato falhando com violação de constraint.
--
-- Causa raiz: contact_merge_log.source_contact_id / target_contact_id são
-- NOT NULL mas têm ON DELETE SET NULL — combinação contraditória. Um contato
-- usado como alvo de merge (merge_contacts()) não pode ser excluído depois,
-- pois o Postgres tenta gravar NULL numa coluna NOT NULL.
ALTER TABLE public.contact_merge_log ALTER COLUMN source_contact_id DROP NOT NULL;
ALTER TABLE public.contact_merge_log ALTER COLUMN target_contact_id DROP NOT NULL;

-- Defesa em profundidade: voice_calls, whatsapp_calls e leads referenciam
-- contacts sem ON DELETE (default NO ACTION), o que bloquearia a exclusão de
-- qualquer contato com chamadas de voz/WhatsApp ou que tenha se originado de
-- um lead convertido.
ALTER TABLE public.voice_calls DROP CONSTRAINT IF EXISTS voice_calls_contact_id_fkey;
ALTER TABLE public.voice_calls ADD CONSTRAINT voice_calls_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.whatsapp_calls DROP CONSTRAINT IF EXISTS whatsapp_calls_contact_id_fkey;
ALTER TABLE public.whatsapp_calls ADD CONSTRAINT whatsapp_calls_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_converted_to_contact_id_fkey;
ALTER TABLE public.leads ADD CONSTRAINT leads_converted_to_contact_id_fkey
  FOREIGN KEY (converted_to_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
