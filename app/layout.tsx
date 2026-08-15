import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister'
import { InstallBanner } from '@/components/pwa/InstallBanner'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
  title: 'LS CRM',
  description: 'CRM Inteligente para Gestão de Vendas',
}

/**
 * Viewport mobile.
 *
 * `viewportFit: 'cover'` é o que faz `env(safe-area-inset-*)` retornar valores
 * reais. Sem isso as variáveis `--app-safe-area-*` do globals.css resolvem
 * sempre para 0 e a bottom nav fica embaixo do indicador de home do iPhone.
 *
 * `interactiveWidget: 'resizes-content'` faz o teclado virtual encolher a
 * viewport em vez de sobrepor. Sem isso o composer de mensagens some atrás
 * do teclado no Android.
 *
 * `maximumScale`/`userScalable` ficam nos padrões: bloquear zoom quebra
 * acessibilidade e não é necessário quando os inputs têm 16px (ver globals.css).
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
}

/**
 * Componente React `RootLayout`.
 *
 * @param {{ children: ReactNode; }} {
  children,
} - Parâmetro `{
  children,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // suppressHydrationWarning: necessário porque a classe "dark" é aplicada no servidor mas pode ser sobrescrita por tema do sistema no cliente
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased bg-[var(--color-bg)] text-[var(--color-text-primary)]`}>
        <ServiceWorkerRegister />
        <InstallBanner />
        {children}
      </body>
    </html>
  )
}
