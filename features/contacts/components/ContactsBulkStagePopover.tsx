'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { CONTACT_STAGE_OPTIONS } from './ContactFormModal';

interface ContactsBulkStagePopoverProps {
  contactCount: number;
  onSelectStage: (stage: string) => void;
}

/**
 * Botão + popover para mudar o estágio de todos os contatos selecionados na
 * aba Contatos, de uma vez (Lead / MQL / Prospect / Cliente / Outros-Perdidos).
 */
export const ContactsBulkStagePopover: React.FC<ContactsBulkStagePopoverProps> = ({
  contactCount,
  onSelectStage,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
      >
        <ArrowRightLeft size={14} />
        Mudar estágio
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full mt-2 right-0 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {CONTACT_STAGE_OPTIONS.map(stage => (
            <button
              key={stage.value}
              type="button"
              onClick={() => {
                onSelectStage(stage.value);
                setIsOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
            >
              {stage.label}
            </button>
          ))}
          <div className="px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-700">
            Aplica a {contactCount} contato(s) selecionado(s)
          </div>
        </div>
      )}
    </div>
  );
};
