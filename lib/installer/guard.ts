import 'server-only';

import { createStaticAdminClient } from '@/lib/supabase/server';

/**
 * Guard compartilhado das rotas do instalador.
 *
 * O `.env.example` documenta que "o instalador fica liberado até a primeira
 * instalação", mas essa regra nunca existiu no código: as rotas checavam apenas
 * `INSTALLER_ENABLED !== 'false'` e, quando `INSTALLER_TOKEN` não estava definido,
 * o token era simplesmente ignorado (`if (expectedToken && ...)`). Ou seja, uma
 * instância já instalada que esquecesse de setar `INSTALLER_ENABLED=false` expunha
 * rotas capazes de reconfigurar infraestrutura, sem nenhuma credencial.
 *
 * Este guard implementa a regra que já estava documentada, preservando o fluxo de
 * primeira instalação: instância ainda não inicializada continua aberta.
 *
 * @module lib/installer/guard
 */

export type InstallerGuardResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Consulta se a instância já passou pelo setup inicial.
 *
 * Em caso de falha na consulta assume `true` (já inicializada) — o lado seguro,
 * já que o efeito é exigir token em vez de liberar o instalador.
 */
async function isInstanceInitialized(): Promise<boolean> {
  try {
    const admin = createStaticAdminClient();
    const { data, error } = await admin.rpc('is_instance_initialized');
    if (error) {
      console.error('[installerGuard] falha ao consultar inicialização:', error.message);
      return true;
    }
    return Boolean(data);
  } catch (err) {
    console.error('[installerGuard] erro inesperado:', err);
    return true;
  }
}

/**
 * Autoriza (ou não) uma operação do instalador.
 *
 * Ordem das regras:
 * 1. `INSTALLER_ENABLED=false` bloqueia sempre — comportamento atual, preservado.
 * 2. Token correto autoriza sempre, inclusive em instância já instalada.
 * 3. Sem token, só passa se a instância ainda não foi inicializada.
 *
 * @param providedToken Token enviado no corpo da requisição, se houver.
 */
export async function guardInstallerRoute(
  providedToken?: string
): Promise<InstallerGuardResult> {
  if (process.env.INSTALLER_ENABLED === 'false') {
    return { ok: false, status: 403, error: 'Installer disabled' };
  }

  const expectedToken = process.env.INSTALLER_TOKEN;

  if (expectedToken) {
    if (providedToken !== expectedToken) {
      return { ok: false, status: 403, error: 'Invalid installer token' };
    }
    return { ok: true };
  }

  if (await isInstanceInitialized()) {
    return {
      ok: false,
      status: 403,
      error:
        'Installer locked: instance already initialized. Set INSTALLER_TOKEN to run it again.',
    };
  }

  return { ok: true };
}
