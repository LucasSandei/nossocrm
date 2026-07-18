import { Suspense } from 'react'
import type { Metadata } from 'next'
import { SignupClient } from './SignupClient'

export const metadata: Metadata = { title: 'Criar conta | LS CRM' }

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: Promise<{ plan?: string | string[] }>
}) {
  const params = await searchParams
  const planKey =
    typeof params?.plan === 'string'
      ? params.plan
      : Array.isArray(params?.plan)
        ? params?.plan?.[0] ?? null
        : null

  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-dark-bg">
        <div className="text-center">
          <div className="h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 dark:text-slate-400">Carregando...</p>
        </div>
      </div>
    }>
      <SignupClient planKey={planKey} />
    </Suspense>
  )
}
