/**
 * Roda os testes de integracao que escrevem num Supabase real.
 *
 * Existe como script proprio porque `RUN_DB_TESTS=1 vitest ...` nao funciona no
 * PowerShell nem no cmd, que e onde este projeto costuma rodar. Aqui a variavel
 * e definida pelo Node e vale em qualquer shell.
 *
 * Antes de rodar, confira para qual projeto Supabase o seu `.env.local` aponta:
 * estes testes criam e apagam dados de verdade.
 */
import { spawnSync } from 'node:child_process';

const ARQUIVOS = [
  'test/tools.salesTeamMatrix.test.ts',
  'test/tools.multiTenant.test.ts',
];

console.log('Testes de integracao: criam e apagam dados reais no Supabase do seu .env.local.\n');

const r = spawnSync('npx', ['vitest', 'run', ...ARQUIVOS], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, RUN_DB_TESTS: '1' },
});

process.exit(r.status ?? 1);
