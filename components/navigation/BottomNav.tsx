import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { PRIMARY_NAV } from './navConfig';

export interface BottomNavProps {
  onOpenMore: () => void;
}

export function BottomNav({ onOpenMore }: BottomNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal (mobile)"
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 md:hidden',
        'border-t border-slate-200 dark:border-white/10',
        'bg-white/85 dark:bg-dark-card/85 backdrop-blur',
        'pb-[var(--app-safe-area-bottom,0px)]'
      )}
    >
      <div className="mx-auto flex h-[var(--app-bottom-nav-height,64px)] max-w-screen-sm items-stretch">
        {PRIMARY_NAV.map((item) => {
          const isActive =
            item.href
              ? pathname === item.href || (item.href === '/boards' && pathname === '/pipeline')
              : false;

          const Icon = item.icon;

          // Base compartilhada: alvo de 44px+, label de 10px que não quebra em
          // telas de 360px e faixa superior indicando a aba ativa.
          const itemClass = cn(
            'relative flex flex-1 flex-col items-center justify-center gap-0.5 px-0.5',
            'min-h-[44px] text-[10px] font-medium leading-tight',
            'transition-colors active:bg-slate-100 dark:active:bg-white/5',
            'focus-visible-ring'
          );

          if (item.id === 'more') {
            return (
              <button
                key={item.id}
                type="button"
                onClick={onOpenMore}
                aria-label="Mais opções"
                className={cn(itemClass, 'text-slate-600 dark:text-slate-300')}
              >
                <Icon className="h-6 w-6" aria-hidden="true" />
                <span className="font-display tracking-wide">{item.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={item.id}
              href={item.href!}
              className={cn(
                itemClass,
                isActive
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-slate-600 dark:text-slate-300'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              {isActive && (
                <span
                  className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary-500"
                  aria-hidden="true"
                />
              )}
              <Icon className={cn('h-6 w-6', isActive ? 'text-primary-500' : '')} aria-hidden="true" />
              <span className="font-display tracking-wide">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

