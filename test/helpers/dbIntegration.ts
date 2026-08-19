import { describe } from 'vitest';

/**
 * Guardiao dos testes que escrevem num Supabase de verdade.
 *
 * Estes testes criam boards, contatos e negocios e depois apagam. O problema e
 * que `.env.local` aponta para o mesmo projeto Supabase da producao: rodar a
 * suite inteira significava gravar no banco que o cliente usa, e a seguranca
 * dependia inteiramente da limpeza do `afterAll` completar. Um teste que morre
 * no meio (timeout, queda de rede, Ctrl+C) deixa dado de teste aparecendo no
 * CRM.
 *
 * Por isso ter credencial nao basta mais: e preciso pedir explicitamente, com
 * `RUN_DB_TESTS=1`. O caminho pronto e `npm run test:db`.
 *
 * `npm run test:run` continua rodando todo o resto e nao encosta no banco.
 */
export function hasDbIntegrationOptIn(): boolean {
  return process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
}

/**
 * Use no lugar de `describe` em suites que gravam no banco.
 *
 * @param hasCreds Se as credenciais reais existem no ambiente.
 */
export function describeDbIntegration(hasCreds: boolean) {
  return hasCreds && hasDbIntegrationOptIn() ? describe : describe.skip;
}
