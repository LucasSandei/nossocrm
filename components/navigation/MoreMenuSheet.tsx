import React from 'react';
import Link from 'next/link';
import { LogOut, Moon, Sun } from 'lucide-react';
import { ActionSheet } from '@/components/ui/ActionSheet';
import { cn } from '@/lib/utils/cn';
import { visibleSecondaryNav } from './navConfig';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';

export interface MoreMenuSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Linha de item do sheet: alvo de toque de 48px, largura total. */
const ROW_CLASS = cn(
  'flex w-full items-center gap-3 rounded-xl border border-slate-200 dark:border-white/10',
  'bg-white dark:bg-dark-card',
  'px-3 py-3 min-h-[48px] text-sm font-medium',
  'text-slate-800 dark:text-slate-100',
  'active:bg-slate-100 dark:active:bg-white/10 transition-colors',
  'focus-visible-ring'
);

export function MoreMenuSheet({ isOpen, onClose }: MoreMenuSheetProps) {
  const { profile, signOut } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();
  const secondaryNav = visibleSecondaryNav(profile?.role);

  return (
    <ActionSheet isOpen={isOpen} onClose={onClose} title="Mais" description="Acesse outras áreas do CRM">
      <div className="space-y-2">
        {secondaryNav.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.id} href={item.href} onClick={onClose} className={ROW_CLASS}>
              <Icon className="h-5 w-5 text-slate-500" aria-hidden="true" />
              <span className="font-display tracking-wide">{item.label}</span>
            </Link>
          );
        })}

        {/* Tema: sai do header no mobile para liberar espaço, mas continua
          * a um toque de distância aqui. */}
        <button type="button" onClick={toggleDarkMode} className={ROW_CLASS}>
          {darkMode ? (
            <Sun className="h-5 w-5 text-slate-500" aria-hidden="true" />
          ) : (
            <Moon className="h-5 w-5 text-slate-500" aria-hidden="true" />
          )}
          <span className="font-display tracking-wide">
            {darkMode ? 'Modo claro' : 'Modo escuro'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            onClose();
            signOut();
          }}
          className={cn(ROW_CLASS, 'text-red-600 dark:text-red-400')}
        >
          <LogOut className="h-5 w-5" aria-hidden="true" />
          <span className="font-display tracking-wide">Sair da conta</span>
        </button>
      </div>
    </ActionSheet>
  );
}
