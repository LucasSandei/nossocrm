import { usePersistedState } from '@/hooks/usePersistedState';

/**
 * Hook React `useSettingsController`: preferências pessoais da tela de
 * Configurações.
 *
 * Etiquetas e campos personalizados NÃO ficam aqui — são dados da organização,
 * persistidos no Supabase e gerenciados por `TagsManager` e
 * `ContactCustomFieldsManager` através dos hooks de query.
 *
 * @returns {{ defaultRoute: string; setDefaultRoute: Dispatch<SetStateAction<string>> }} Preferências do usuário.
 */
export const useSettingsController = () => {
  // General Settings
  const [defaultRoute, setDefaultRoute] = usePersistedState<string>('crm_default_route', '/boards');

  return {
    defaultRoute,
    setDefaultRoute,
  };
};
