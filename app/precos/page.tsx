import type { Metadata } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Preços | LS CRM' }

type Plan = {
  id: string
  key: string
  name: string
  price_cents: number
  currency: string
  billing_interval: string
  limits: { max_users?: number } | null
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100)
}

export default async function PrecosPage() {
  const supabase = await createClient()
  const { data: plans } = await supabase
    .from('plans')
    .select('id, key, name, price_cents, currency, billing_interval, limits')
    .eq('active', true)
    .order('sort_order', { ascending: true })

  const list = (plans ?? []) as Plan[]

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-dark-bg relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-primary-500/20 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] -left-[10%] w-[40%] h-[40%] bg-blue-500/20 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-14">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white font-display tracking-tight mb-3">
            Planos do LS CRM
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-lg">
            7 dias de teste grátis em qualquer plano, sem cartão de crédito.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {list.map((plan) => (
            <div
              key={plan.id}
              className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl p-8 flex flex-col"
            >
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1">{plan.name}</h2>
              <div className="mb-6">
                <span className="text-3xl font-bold text-slate-900 dark:text-white">
                  {formatPrice(plan.price_cents, plan.currency)}
                </span>
                <span className="text-slate-500 dark:text-slate-400">/mês</span>
              </div>

              {plan.limits?.max_users && (
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 mb-2">
                  <Check className="h-4 w-4 text-primary-500 shrink-0" />
                  Até {plan.limits.max_users} usuários
                </div>
              )}

              <div className="flex-1" />

              <Link
                href={`/signup?plan=${encodeURIComponent(plan.key)}`}
                className="mt-6 w-full flex justify-center items-center py-3 px-4 rounded-xl shadow-lg shadow-primary-500/20 text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 transition-all active:scale-[0.98]"
              >
                Começar teste grátis
              </Link>
            </div>
          ))}
        </div>

        <p className="text-center text-sm text-slate-400 dark:text-slate-500 mt-10">
          Já tem uma conta?{' '}
          <Link href="/login" className="text-primary-500 hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  )
}
