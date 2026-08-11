'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import type { User } from '@supabase/supabase-js'

import { QueryProvider } from '@/lib/query'
import { ToastProvider } from '@/context/ToastContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { AuthProvider, type Profile } from '@/context/AuthContext'
import { AIProvider } from '@/context/AIContext'
import Layout from '@/components/Layout'
import { TooltipProvider } from '@/components/ui/tooltip'

export default function ProtectedShell({
    children,
    initialUser = null,
    initialProfile = null,
}: {
    children: React.ReactNode
    /** Sessão já resolvida no servidor — evita a cascata de auth no cliente. */
    initialUser?: User | null
    initialProfile?: Profile | null
}) {
    const pathname = usePathname()
    const isSetupRoute = pathname === '/setup'
    const isLabsRoute = pathname === '/labs' || pathname.startsWith('/labs/')
    const shouldUseAppShell = !isSetupRoute && !isLabsRoute

    // #region agent log
    useEffect(() => {
      if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
        const detectEnv = async () => {
          const env = {
            userAgent: navigator.userAgent,
            isCursorBrowser: navigator.userAgent.includes('Cursor') || window.location.hostname === 'localhost',
            hasServiceWorker: 'serviceWorker' in navigator,
            serviceWorkerReady: false,
            cacheAvailable: 'caches' in window,
            devToolsOpen: false,
            reactDevTools: !!(window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__,
            localStorageAvailable: typeof Storage !== 'undefined',
            sessionStorageAvailable: typeof sessionStorage !== 'undefined',
          };

          // Check service worker
          if (env.hasServiceWorker) {
            try {
              const registration = await navigator.serviceWorker.getRegistration();
              env.serviceWorkerReady = !!registration;
            } catch {}
          }

          // Detect DevTools (heuristic)
          let devtools = false;
          const threshold = 160;
          const widthThreshold = window.outerWidth - window.innerWidth > threshold;
          const heightThreshold = window.outerHeight - window.innerHeight > threshold;
          devtools = widthThreshold || heightThreshold;
          env.devToolsOpen = devtools;

        };
        detectEnv();
      }
    }, [pathname]);
    // #endregion

    return (
        <QueryProvider>
            <ToastProvider>
                <ThemeProvider>
                    <AuthProvider initialUser={initialUser} initialProfile={initialProfile}>
                        <AIProvider>
                            <TooltipProvider delayDuration={200}>
                                {shouldUseAppShell ? <Layout>{children}</Layout> : children}
                            </TooltipProvider>
                        </AIProvider>
                    </AuthProvider>
                </ThemeProvider>
            </ToastProvider>
        </QueryProvider>
    )
}
