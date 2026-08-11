import ProtectedShell from './ProtectedShell'
import Script from 'next/script'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/context/AuthContext'

/**
 * Resolve usuário e perfil no servidor, no mesmo request que já carrega a página.
 *
 * O `proxy.ts` valida e renova a sessão Supabase antes da página ser renderizada,
 * então esses dados já estão disponíveis aqui sem custo de rede adicional para o
 * usuário. Entregá-los prontos ao `AuthProvider` elimina duas idas à rede em série
 * no cliente (`getUser()` → `fetchProfile()`) que mantinham a tela em branco.
 *
 * Qualquer falha aqui é silenciosa e não bloqueia o render: o `AuthProvider`
 * simplesmente volta a resolver a sessão no cliente, como fazia antes.
 */
async function getInitialAuth() {
    try {
        const supabase = await createClient()

        const { data: { user }, error } = await supabase.auth.getUser()
        if (error || !user) return { initialUser: null, initialProfile: null }

        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle()

        return {
            initialUser: user,
            initialProfile: (profile as Profile | null) ?? null,
        }
    } catch {
        return { initialUser: null, initialProfile: null }
    }
}

export default async function ProtectedLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { initialUser, initialProfile } = await getInitialAuth()

    return (
        <>
            {/* lamejs loaded globally to avoid Turbopack CJS interop issues.
                Mp3Encoder uses internal vars (MPEGMode) that Turbopack tree-shakes
                when imported as ESM. Script tag runs in original scope, preserving closures. */}
            <Script src="/lame.min.js" strategy="lazyOnload" />
            <ProtectedShell initialUser={initialUser} initialProfile={initialProfile}>
                {children}
            </ProtectedShell>
        </>
    )
}
