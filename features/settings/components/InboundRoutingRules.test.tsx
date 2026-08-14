import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { InboundRoutingRules } from './InboundRoutingRules';

/**
 * O editor de regras já nasceu com o campo de valor no JSX, mas ele não chegava
 * na tela: a linha era um flex dentro de um modal estreito, e o input era
 * empurrado para fora do painel, que tem `overflow-hidden`. Quem configurava
 * escolhia "Link de campanha é igual a" e não tinha onde digitar o link.
 *
 * Estes testes prendem o contrato pelo lado do usuário, que é o único lugar
 * onde o defeito aparecia.
 */

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'user-1', organization_id: 'org-1' } }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('@/lib/query/hooks/useBoardsQuery', () => ({
  useBoards: () => ({
    data: [{ id: 'board-1', name: 'Pipeline de Vendas', stages: [{ id: 'stage-1', label: 'Novas' }] }],
  }),
}));

vi.mock('@/lib/query/hooks/useTagsQuery', () => ({
  useTags: () => ({ data: [{ id: 'tag-1', name: 'Instagram' }] }),
}));

vi.mock('@/lib/query/hooks/useOrgMembersQuery', () => ({
  useOrgMembersQuery: () => ({ data: [{ id: 'member-1', name: 'Jéssica' }] }),
}));

// Campos do catálogo entram no mesmo seletor das condições, com prefixo `cf:`.
vi.mock('@/lib/query/hooks/useContactCustomFieldsQuery', () => ({
  useContactCustomFieldDefinitions: () => ({
    data: [
      { id: 'cf-1', key: 'possui_vaginismo', label: 'Possui vaginismo', type: 'boolean', options: null },
      { id: 'cf-2', key: 'grau_do_vaginismo', label: 'Grau do Vaginismo', type: 'select', options: ['1', '2'] },
    ],
  }),
}));

// Sem fonte de dados as regras carregam vazias, que é o estado de "criar a primeira".
vi.mock('@/lib/supabase/client', () => ({ supabase: null }));

async function abrirEditor() {
  const user = userEvent.setup();
  render(<InboundRoutingRules sourceId="source-1" />);
  await user.click(screen.getByRole('button', { name: /nova regra/i }));
  return user;
}

describe('editor de regra de entrada', () => {
  it('oferece onde digitar o valor da condição', async () => {
    await abrirEditor();

    // O rótulo acompanha o campo escolhido, para o usuário saber o que digitar.
    const valor = screen.getByRole('textbox', { name: /valor de link de campanha/i });
    expect(valor).toBeInTheDocument();
  });

  it('sugere um exemplo coerente com o campo de origem escolhido', async () => {
    const user = await abrirEditor();

    const valorInicial = screen.getByRole('textbox', { name: /valor de link de campanha/i });
    expect(valorInicial).toHaveAttribute('placeholder', expect.stringMatching(/^c0ffee00-/));

    await user.selectOptions(screen.getByRole('combobox', { name: /campo de origem/i }), 'utm_source');

    const valorUtm = screen.getByRole('textbox', { name: /valor de utm_source/i });
    expect(valorUtm).toHaveAttribute('placeholder', 'instagram');
  });

  /*
   * "Formulário" e "Link de campanha" aceitam um UUID cada, e nada na tela
   * distingue os dois valores. Colar o id de um link em "Formulário" produziu
   * uma regra que nunca casava e outra que virava pega-tudo, mandando todo
   * lead para o mesmo funil. O aviso é o que resta para separá-los.
   */
  it('avisa que o campo Formulário não recebe id de link', async () => {
    const user = await abrirEditor();

    await user.selectOptions(screen.getByRole('combobox', { name: /campo de origem/i }), 'form_id');

    expect(screen.getByText(/não o de um link/i)).toBeInTheDocument();
    expect(screen.getByText(/use link de campanha/i)).toBeInTheDocument();
  });

  it('troca o campo de valor por uma explicação quando o operador dispensa valor', async () => {
    const user = await abrirEditor();

    await user.selectOptions(screen.getByRole('combobox', { name: /operador/i }), 'exists');

    expect(screen.queryByRole('textbox', { name: /valor de/i })).not.toBeInTheDocument();
    expect(screen.getByText(/basta o campo vir preenchido/i)).toBeInTheDocument();
  });

  it('mantém os três controles na mesma condição ao adicionar outra', async () => {
    const user = await abrirEditor();

    await user.click(screen.getByRole('button', { name: /adicionar condição/i }));

    expect(screen.getAllByRole('combobox', { name: /campo de origem/i })).toHaveLength(2);
    expect(screen.getAllByRole('combobox', { name: /operador/i })).toHaveLength(2);
    expect(screen.getAllByRole('textbox', { name: /valor de/i })).toHaveLength(2);
  });

  it('deixa os botões de ação dentro do formulário, alcançáveis', async () => {
    await abrirEditor();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /criar regra/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /cancelar/i })).toBeInTheDocument();
  });
});

/**
 * Classificação como critério de roteamento.
 *
 * Separar uma lead pronta para comprar exige olhar o que o formulário
 * classificou, não só de onde ela veio. Sem os campos do catálogo no seletor,
 * essa regra teria de ser escrita direto no banco.
 */
describe('campos personalizados no seletor de condição', () => {
  it('oferece os campos do catálogo junto dos de origem', async () => {
    await abrirEditor();

    const campo = screen.getByRole('combobox', { name: /campo de origem/i });
    expect(within(campo).getByRole('option', { name: /link de campanha/i })).toBeInTheDocument();
    expect(within(campo).getByRole('option', { name: /possui vaginismo/i })).toBeInTheDocument();
    expect(within(campo).getByRole('option', { name: /grau do vaginismo/i })).toBeInTheDocument();
  });

  // O prefixo é o que impede um campo chamado `source` de disputar nome com a
  // origem declarada.
  it('grava o campo do catálogo com o prefixo que o motor entende', async () => {
    const user = await abrirEditor();

    const campo = screen.getByRole('combobox', { name: /campo de origem/i });
    await user.selectOptions(campo, 'cf:possui_vaginismo');

    expect((campo as HTMLSelectElement).value).toBe('cf:possui_vaginismo');
    expect(screen.getByRole('textbox', { name: /valor de possui vaginismo/i })).toBeInTheDocument();
  });
});
