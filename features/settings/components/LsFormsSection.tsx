import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Loader2,
  Unplug,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';

interface FormsCatalogItem {
  id: string;
  title: string;
  type: string;
  status: string;
  updated_at: string;
}

interface FormsSettingsState {
  connected: boolean;
  maskedKey: string | null;
  baseUrl: string;
  defaultBaseUrl: string;
  enabledIds: string[];
  forms: FormsCatalogItem[];
  catalogError: string | null;
}

const CATALOG_DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR');

/**
 * Conexão com o LS Forms.
 *
 * A chave é gravada só depois de o servidor provar que ela funciona, e nunca
 * volta inteira para a tela — o GET devolve apenas o prefixo mascarado.
 */
export const LsFormsSection: React.FC = () => {
  const { addToast } = useToast();

  const [state, setState] = useState<FormsSettingsState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  /** Seleção em edição. Vazio = todos os formulários. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savedSelection, setSavedSelection] = useState<string>('[]');
  const [isSavingSelection, setIsSavingSelection] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/forms/settings', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Falha ao carregar a configuração.');
      const body = (await res.json()) as FormsSettingsState;
      setState(body);
      setBaseUrl(body.baseUrl === body.defaultBaseUrl ? '' : body.baseUrl);
      setSelected(new Set(body.enabledIds ?? []));
      setSavedSelection(JSON.stringify([...(body.enabledIds ?? [])].sort()));
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao carregar.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim()) {
      addToast('Cole a chave do LS Forms.', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/forms/settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), baseUrl: baseUrl.trim() }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) throw new Error(body?.error || 'Não foi possível conectar.');

      addToast('LS Forms conectado.', 'success');
      setApiKey('');
      await load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao conectar.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleForm = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSaveSelection = async () => {
    setIsSavingSelection(true);
    try {
      const enabledIds = [...selected];
      const res = await fetch('/api/forms/settings', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledIds }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Falha ao salvar a seleção.');

      setSavedSelection(JSON.stringify(enabledIds.sort()));
      addToast(
        enabledIds.length === 0
          ? 'Todos os formulários passam a alimentar o CRM.'
          : `${enabledIds.length} formulário(s) selecionado(s).`,
        'success',
      );
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao salvar.', 'error');
    } finally {
      setIsSavingSelection(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Desconectar o LS Forms? As abas Formulários deixarão de carregar.')) {
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch('/api/forms/settings', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('Falha ao desconectar.');
      addToast('LS Forms desconectado.', 'success');
      await load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao desconectar.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        Carregando…
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <ClipboardList size={18} /> LS Forms
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Conectado, o CRM mostra na aba <strong>Formulários</strong> de cada contato e de cada
          card do board tudo o que a pessoa respondeu — lido ao vivo, incluindo respostas em
          andamento.
        </p>
      </div>

      {state?.connected && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 size={16} aria-hidden="true" /> Conectado
            </p>
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400 font-mono">
              {state.maskedKey}
            </p>
            <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-400/80">
              {state.baseUrl}
            </p>
          </div>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={isSaving}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 transition-colors"
          >
            <Unplug size={14} aria-hidden="true" /> Desconectar
          </button>
        </div>
      )}

      {state?.connected && (
        <section className="rounded-xl border border-slate-200 dark:border-white/10 p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Formulários que alimentam o CRM
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {selected.size === 0
                  ? 'Nenhum marcado: todos os formulários do workspace aparecem no CRM.'
                  : `Só os ${selected.size} marcado(s) aparecem nas abas Formulários.`}
              </p>
            </div>
            {JSON.stringify([...selected].sort()) !== savedSelection && (
              <button
                type="button"
                onClick={handleSaveSelection}
                disabled={isSavingSelection}
                className="shrink-0 inline-flex items-center gap-1.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
              >
                {isSavingSelection && (
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                )}
                Salvar seleção
              </button>
            )}
          </div>

          {state.catalogError ? (
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <AlertTriangle size={13} aria-hidden="true" />
              {state.catalogError}
            </p>
          ) : state.forms.length === 0 ? (
            <p className="text-xs text-slate-500 italic">
              Nenhum formulário encontrado neste workspace do LS Forms.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-2">
                <button
                  type="button"
                  onClick={() => setSelected(new Set(state.forms.map(f => f.id)))}
                  className="text-xs font-bold text-primary-600 dark:text-primary-400 hover:underline"
                >
                  Marcar todos
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-xs font-bold text-slate-500 hover:underline"
                >
                  Limpar (usar todos)
                </button>
              </div>

              <ul className="divide-y divide-slate-100 dark:divide-white/5 max-h-72 overflow-y-auto">
                {state.forms.map(form => (
                  <li key={form.id}>
                    <label className="flex items-center gap-3 py-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={selected.has(form.id)}
                        onChange={() => toggleForm(form.id)}
                        className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 cursor-pointer"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-slate-900 dark:text-white truncate">
                          {form.title || 'Sem título'}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {form.type === 'quiz' ? 'Quiz' : 'Formulário'}
                          {form.status ? ` • ${form.status}` : ''}
                          {form.updated_at
                            ? ` • atualizado em ${CATALOG_DATE_FORMATTER.format(new Date(form.updated_at))}`
                            : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label htmlFor="forms-api-key" className="block text-xs font-bold text-slate-500 uppercase mb-1">
            {state?.connected ? 'Substituir a chave' : 'Chave da API do LS Forms'}
          </label>
          <input
            id="forms-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="lsf_..."
            className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 font-mono"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            Gere em LS Forms → Configurações → API, com escopo de leitura. A chave é validada
            antes de ser salva e nunca é devolvida para esta tela.
          </p>
        </div>

        <details className="group">
          <summary className="text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300">
            Endereço da API (avançado)
          </summary>
          <div className="mt-2">
            <input
              type="url"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder={state?.defaultBaseUrl}
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 font-mono"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Em branco usa <code>{state?.defaultBaseUrl}</code>.
            </p>
          </div>
        </details>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSaving || !apiKey.trim()}
            className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
          >
            {isSaving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {state?.connected ? 'Substituir e validar' : 'Conectar e validar'}
          </button>
          <a
            href="https://forms.lucassandei.com.br"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-primary-600 dark:text-primary-400 hover:underline"
          >
            Abrir LS Forms <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      </form>
    </div>
  );
};
