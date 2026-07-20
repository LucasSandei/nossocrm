import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, Clock, Ban, CreditCard, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Assinatura | LS CRM' }

type Plan = {
  name: string
  price_cents: number
  currency: string
  billing_interval: string
}

type Subscription = {
  status: string
  trial_ends_at: string | null
  current_period_end: string | null
  plan: Plan | Plan[] | null
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100)
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(iso))
}

const STATUS_CONTENT: Record<
  string,
  { icon: typeof AlertTriangle; title: string; description: string; tone: 'warn' | 'error' | 'ok' }
> = {
  trialing: {
    icon: Clock,
    title: 'Você está no período de teste grátis',
    description: 'Aproveite para explorar o LS CRM. Escolha um plano a qualquer momento para continuar depois do teste.',
    tone: 'ok',
  },
  trial_expired: {
    icon: AlertTriangle,
    title: 'Seu teste grátis terminou',
    description: 'Escolha um plano para continuar usando o LS CRM sem interrupções.',
    tone: 'error',
  },
  active: {
    icon: CheckCircle2,
    title: 'Sua assinatura está ativa',
    description: 'Obrigado por ser cliente do LS CRM.',
    tone: 'ok',
  },
  past_due: {
    icon: AlertTriangle,
    title: 'Pagamento pendente',
    description: 'Identificamos um problema no pagamento da sua assinatura. Regularize para não perder o acesso.',
    tone: 'error',
  },
  canceled: {
    icon: Ban,
    title: 'Assinatura cancelada',
    description: 'Sua assinatura foi cancelada. Escolha um plano para reativar o acesso ao LS CRM.',
    tone: 'error',
  },
  pending_payment: {
    icon: Clock,
    title: 'Aguardando confirmação de pagamento',
    description: 'Assim que o pagamento for confirmado, seu acesso será liberado automaticamente.',
    tone: 'warn',
  },
}

const toneClasses: Record<'warn' | 'error' | 'ok', string> = {
  ok: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-400',
  warn: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900/40 text-amber-700 dark:text-amber-400',
  error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400',
}

export default async function BillingPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: status }, { data: subscription }] = await Promise.all([
    supabase.rpc('get_org_billing_status'),
    supabase
      .from('organization_subscriptions')
      .select('status, trial_ends_at, current_period_end, plan:plans(name, price_cents, currency, billing_interval)')
      .maybeSingle<Subscription>(),
  ])

  const effectiveStatus = (status as string | null) ?? subscription?.status ?? null
  const content = effectiveStatus ? STATUS_CONTENT[effectiveStatus] : null
  const plan = Array.isArray(subscription?.plan) ? subscription?.plan[0] : subscription?.plan
  const Icon = content?.icon ?? CreditCard

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-dark-bg relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-primary-500/20 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] -left-[10%] w-[40%] h-[40%] bg-blue-500/20 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-4 py-20">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight mb-2">
            Assinatura
          </h1>
          <p className="text-slate-500 dark:text-slate-400">Status da assinatura do LS CRM para a sua organização.</p>
        </div>

        <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl p-8">
          {content ? (
            <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 mb-6 ${toneClasses[content.tone]}`}>
              <Icon className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">{content.title}</p>
                <p className="text-sm opacity-90 mt-0.5">{content.description}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border px-4 py-3 mb-6 bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
              <CreditCard className="h-5 w-5 shrink-0 mt-0.5" />
              <p className="text-sm">Nenhuma assinatura encontrada para esta organização.</p>
            </div>
          )}

          <dl className="space-y-3 text-sm">
            {plan && (
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Plano atual</dt>
                <dd className="font-medium text-slate-900 dark:text-white">
                  {plan.name} — {formatPrice(plan.price_cents, plan.currency)}/mês
                </dd>
              </div>
            )}
            {effectiveStatus === 'trialing' && subscription?.trial_ends_at && (
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Teste grátis até</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{formatDate(subscription.trial_ends_at)}</dd>
              </div>
            )}
            {subscription?.current_period_end && (
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Próxima cobrança</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{formatDate(subscription.current_period_end)}</dd>
              </div>
            )}
          </dl>

          <div className="flex flex-col sm:flex-row gap-3 mt-8">
            <Link
              href="/precos"
              className="flex-1 flex justify-center items-center py-3 px-4 rounded-xl shadow-lg shadow-primary-500/20 text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 transition-all active:scale-[0.98]"
            >
              Ver planos
            </Link>
            {effectiveStatus === 'active' && (
              <Link
                href="/dashboard"
                className="flex-1 flex justify-center items-center py-3 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all active:scale-[0.98]"
              >
                Voltar ao painel
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
