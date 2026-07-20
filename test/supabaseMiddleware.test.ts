import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

type MockUser = { id: string }
const mocks = vi.hoisted(() => {
  const state = {
    currentUser: null as MockUser | null,
    billingStatus: null as string | null,
    billingError: null as { message: string } | null,
  }

  const nextResponseMock = {
    next: vi.fn((init?: unknown) => ({
      kind: 'next',
      init,
      cookies: {
        set: vi.fn(),
      },
    })),
    redirect: vi.fn((url: unknown) => ({
      kind: 'redirect',
      url,
    })),
  }

  const supabaseSsrMock = {
    createServerClient: vi.fn(() => ({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: state.currentUser } })),
      },
      rpc: vi.fn(async (fnName: string) => {
        if (fnName === 'is_instance_initialized') return { data: true, error: null }
        if (fnName === 'get_org_billing_status') {
          return { data: state.billingStatus, error: state.billingError }
        }
        return { data: null, error: null }
      }),
    })),
  }

  return { state, nextResponseMock, supabaseSsrMock }
})

vi.mock('next/server', () => ({
  NextResponse: mocks.nextResponseMock,
}))

vi.mock('@supabase/ssr', () => mocks.supabaseSsrMock)

import { updateSession } from '../lib/supabase/middleware'

type MockRequest = {
  nextUrl: {
    pathname: string
    clone(): { pathname: string }
  }
  cookies: {
    getAll(): unknown[]
    set: ReturnType<typeof vi.fn>
  }
}

function makeRequest(pathname: string) {
  const req: MockRequest = {
    nextUrl: {
      pathname,
      clone() {
        return { pathname }
      },
    },
    cookies: {
      getAll() {
        return []
      },
      set: vi.fn(),
    },
  }

  return req as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.currentUser = null
  mocks.state.billingStatus = null
  mocks.state.billingError = null

  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://example.supabase.local')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('updateSession (Proxy/Supabase)', () => {
  it('bypassa /api/* sem chamar Supabase', async () => {
    const req = makeRequest('/api/health')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.next).toHaveBeenCalledTimes(1)
    expect(mocks.supabaseSsrMock.createServerClient).not.toHaveBeenCalled()
    expect(res).toMatchObject({ kind: 'next' })
  })

  it('permite /setup sem autenticação (sem redirect)', async () => {
    const req = makeRequest('/setup')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
    expect(res).toMatchObject({ kind: 'next' })
  })

  it('permite /join/* sem autenticação (sem redirect)', async () => {
    const req = makeRequest('/join')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
    expect(res).toMatchObject({ kind: 'next' })
  })

  it('permite /auth/callback sem autenticação (sem redirect)', async () => {
    const req = makeRequest('/auth/callback')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
    expect(res).toMatchObject({ kind: 'next' })
  })

  it('redireciona rota protegida para /login quando não autenticado', async () => {
    const req = makeRequest('/dashboard')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).toHaveBeenCalledTimes(1)
    const [urlArg] = mocks.nextResponseMock.redirect.mock.calls[0]
    expect(urlArg).toMatchObject({ pathname: '/login' })
    expect(res).toMatchObject({ kind: 'redirect' })
  })

  it('redireciona usuário autenticado para /dashboard quando acessa /login', async () => {
    mocks.state.currentUser = { id: 'user-1' }
    const req = makeRequest('/login')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).toHaveBeenCalledTimes(1)
    const [urlArg] = mocks.nextResponseMock.redirect.mock.calls[0]
    expect(urlArg).toMatchObject({ pathname: '/dashboard' })
    expect(res).toMatchObject({ kind: 'redirect' })
  })

  describe('billing guard', () => {
    it.each(['active', 'trialing'])(
      'não bloqueia rota protegida quando status é "%s"',
      async (billingStatus) => {
        mocks.state.currentUser = { id: 'user-1' }
        mocks.state.billingStatus = billingStatus
        const req = makeRequest('/dashboard')

        const res = await updateSession(req)

        expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
        expect(res).toMatchObject({ kind: 'next' })
      }
    )

    it.each(['trial_expired', 'past_due', 'canceled', 'pending_payment'])(
      'redireciona para /billing quando status é "%s"',
      async (billingStatus) => {
        mocks.state.currentUser = { id: 'user-1' }
        mocks.state.billingStatus = billingStatus
        const req = makeRequest('/dashboard')

        const res = await updateSession(req)

        expect(mocks.nextResponseMock.redirect).toHaveBeenCalledTimes(1)
        const [urlArg] = mocks.nextResponseMock.redirect.mock.calls[0]
        expect(urlArg).toMatchObject({ pathname: '/billing' })
        expect(res).toMatchObject({ kind: 'redirect' })
      }
    )

    it('não entra em loop ao acessar /billing com status bloqueante', async () => {
      mocks.state.currentUser = { id: 'user-1' }
      mocks.state.billingStatus = 'past_due'
      const req = makeRequest('/billing')

      const res = await updateSession(req)

      expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
      expect(res).toMatchObject({ kind: 'next' })
    })

    it('não bloqueia rotas públicas mesmo com status bloqueante', async () => {
      mocks.state.currentUser = { id: 'user-1' }
      mocks.state.billingStatus = 'past_due'
      const req = makeRequest('/precos')

      const res = await updateSession(req)

      expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
      expect(res).toMatchObject({ kind: 'next' })
    })

    it('falha aberta (sem redirect) quando a RPC de billing retorna erro', async () => {
      mocks.state.currentUser = { id: 'user-1' }
      mocks.state.billingStatus = null
      mocks.state.billingError = { message: 'boom' }
      const req = makeRequest('/dashboard')

      const res = await updateSession(req)

      expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
      expect(res).toMatchObject({ kind: 'next' })
    })

    it('falha aberta quando não há assinatura (status null)', async () => {
      mocks.state.currentUser = { id: 'user-1' }
      mocks.state.billingStatus = null
      const req = makeRequest('/dashboard')

      const res = await updateSession(req)

      expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
      expect(res).toMatchObject({ kind: 'next' })
    })
  })
})
