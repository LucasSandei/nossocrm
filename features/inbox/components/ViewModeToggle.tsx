import React from 'react';
import { LayoutDashboard, List, Target } from 'lucide-react';
import { ViewMode } from '../hooks/useInboxController';

interface ViewModeToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  /**
   * Esconde o modo Foco.
   *
   * O Foco é um cockpit de três colunas fixas (contato · atividade · workspace)
   * que não cabe numa tela de celular. No mobile o Inbox fica em Visão Geral e
   * Lista, que já cobrem "o que preciso fazer agora".
   */
  hideFocus?: boolean;
}

/**
 * Componente React `ViewModeToggle`.
 *
 * @param {ViewModeToggleProps} { mode, onChange, hideFocus } - Parâmetro `{ mode, onChange, hideFocus }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({ mode, onChange, hideFocus = false }) => {
  const buttonClass = (isActive: boolean) =>
    `flex flex-1 sm:flex-none items-center justify-center gap-2 px-3 min-h-[40px] rounded-md text-sm font-medium transition-all ${
      isActive
        ? 'bg-white dark:bg-dark-card text-slate-900 dark:text-white shadow-sm'
        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
    }`;

  return (
    <div
      className="flex w-full sm:inline-flex sm:w-auto items-center bg-slate-100 dark:bg-white/5 rounded-lg p-1 border border-slate-200 dark:border-white/10"
      role="group"
      aria-label="Modo de visualização"
    >
      <button
        onClick={() => onChange('overview')}
        aria-pressed={mode === 'overview'}
        className={buttonClass(mode === 'overview')}
      >
        <LayoutDashboard size={16} aria-hidden="true" />
        Visão Geral
      </button>
      <button
        onClick={() => onChange('list')}
        aria-pressed={mode === 'list'}
        className={buttonClass(mode === 'list')}
      >
        <List size={16} aria-hidden="true" />
        Lista
      </button>
      {!hideFocus && (
        <button
          onClick={() => onChange('focus')}
          aria-pressed={mode === 'focus'}
          className={buttonClass(mode === 'focus')}
        >
          <Target size={16} aria-hidden="true" />
          Foco
        </button>
      )}
    </div>
  );
};
