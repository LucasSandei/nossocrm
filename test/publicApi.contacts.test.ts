/**
 * Testes para a API pública de contacts.
 *
 * GET  /api/public/v1/contacts — listagem com filtros e paginação
 * POST /api/public/v1/contacts — upsert de contato (cria ou atualiza)
 *
 * Estratégia: vi.mock para authPublicApi e Supabase. Sem I/O real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------
// UUIDs v4 válidos (versão 4, variante 8 na posição 19)
const ORG_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5'
const CONTACT_ID = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7'
const TAG_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f'

const AUTH_OK = {
  ok: true as const,
  organizationId: ORG_ID,
  organizationName: 'Org Test',
  apiKeyId: 'key-id-1',
  apiKeyPrefix: 'test_',
}

const CONTACT_FIXTURE = {
  id: CONTACT_ID,
  name: 'Maria Silva',
  email: 'maria@exemplo.com',
  phone: '+5511999990000',
  role: null,
  company_name: null,
  client_company_id: null,
  avatar: null,
  notes: null,
  status: 'ACTIVE',
  stage: 'LEAD',
  source: null,
  birth_date: null,
  last_interaction: null,
  last_purchase_date: null,
  total_value: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/public-api/auth', () => ({
  authPublicApi: vi.fn(),
}))

const contactQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  range: vi.fn(async () => ({
    data: [CONTACT_FIXTURE],
    count: 1,
    error: null,
  })),
  maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  single: vi.fn(async () => ({
    data: CONTACT_FIXTURE,
    error: null,
  })),
}

const companyQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  insert: vi.fn().mockReturnThis(),
  single: vi.fn(async () => ({
    data: { id: 'company-001' },
    error: null,
  })),
}

/**
 * Catálogo de etiquetas da organização. `eq` encerra a cadeia em resolveTagIds
 * (`select(...).eq('organization_id', ...)`), por isso resolve direto.
 */
const tagsQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn(async () => ({
    data: [{ id: TAG_ID, name: 'Instagram' }],
    error: null,
  })),
  upsert: vi.fn(() => ({
    select: vi.fn(async () => ({ data: [], error: null })),
  })),
}

/** Junction contact_tags: leitura paginada por `range`, escrita por insert/upsert. */
const contactTagsQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn(async () => ({
    data: [{ contact_id: CONTACT_ID, tags: { name: 'Instagram' } }],
    error: null,
  })),
  delete: vi.fn().mockReturnThis(),
  insert: vi.fn(async () => ({ error: null })),
  upsert: vi.fn(async () => ({ error: null })),
}

/**
 * Definições de campos personalizados de contato. A cadeia termina no segundo
 * `eq` (organization_id + entity_type), por isso ele resolve a promise.
 */
const customFieldDefsQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn(function (this: any, column: string) {
    if (column === 'entity_type') {
      return Promise.resolve({
        data: [
          { key: 'origemFormulario', type: 'text' },
          { key: 'interesse', type: 'text' },
          { key: 'aceitaContato', type: 'boolean' },
          { key: 'valorPlano', type: 'currency' },
          { key: 'dataAula', type: 'date' },
        ],
        error: null,
      })
    }
    return this
  }),
}

const supabaseMock = {
  from: vi.fn((table: string) => {
    if (table === 'contacts') return contactQueryBuilder
    if (table === 'crm_companies') return companyQueryBuilder
    if (table === 'tags') return tagsQueryBuilder
    if (table === 'contact_tags') return contactTagsQueryBuilder
    if (table === 'custom_field_definitions') return customFieldDefsQueryBuilder
    throw new Error(`Unexpected table: ${table}`)
  }),
}

vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: vi.fn(() => supabaseMock),
}))

// ---------------------------------------------------------------------------
// Imports (após mocks)
// ---------------------------------------------------------------------------
import { GET, POST } from '@/app/api/public/v1/contacts/route'
import { authPublicApi } from '@/lib/public-api/auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeGetRequest(url: string): Request {
  return new Request(url)
}

function makePostRequest(body: unknown): Request {
  return new Request('http://localhost/api/public/v1/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Testes GET
// ---------------------------------------------------------------------------
describe('GET /api/public/v1/contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authPublicApi).mockResolvedValue(AUTH_OK)
    contactQueryBuilder.range.mockResolvedValue({
      data: [CONTACT_FIXTURE],
      count: 1,
      error: null,
    })
  })

  it('retorna 401 quando API key ausente', async () => {
    // Arrange
    vi.mocked(authPublicApi).mockResolvedValue({
      ok: false,
      status: 401,
      body: { error: 'Missing X-Api-Key', code: 'AUTH_MISSING' },
    })

    // Act
    const res = await GET(makeGetRequest('http://localhost/api/public/v1/contacts'))
    const body = await res.json()

    // Assert
    expect(res.status).toBe(401)
    expect(body.code).toBe('AUTH_MISSING')
  })

  it('retorna lista de contatos com shape correta', async () => {
    // Act
    const res = await GET(makeGetRequest('http://localhost/api/public/v1/contacts'))
    const body = await res.json()

    // Assert
    expect(res.status).toBe(200)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body).toHaveProperty('nextCursor')

    const c = body.data[0]
    expect(c).toMatchObject({
      id: CONTACT_ID,
      name: 'Maria Silva',
      email: 'maria@exemplo.com',
      phone: '+5511999990000',
    })
    // Campos nullable devem existir como null
    expect(c).toHaveProperty('role', null)
    expect(c).toHaveProperty('birth_date', null)
    expect(c).toHaveProperty('total_value', null)
    // Etiquetas e campos personalizados fazem parte do payload do contato.
    expect(c.tags).toEqual(['Instagram'])
    expect(c.custom_fields).toEqual({})
  })

  it('devolve custom_fields quando o contato tem valores gravados', async () => {
    // Arrange
    contactQueryBuilder.range.mockResolvedValueOnce({
      data: [{ ...CONTACT_FIXTURE, custom_fields: { origemFormulario: 'Landing Page' } }],
      count: 1,
      error: null,
    })

    // Act
    const res = await GET(makeGetRequest('http://localhost/api/public/v1/contacts'))
    const body = await res.json()

    // Assert
    expect(body.data[0].custom_fields).toEqual({ origemFormulario: 'Landing Page' })
  })

  it('normaliza total_value para number quando presente', async () => {
    // Arrange
    contactQueryBuilder.range.mockResolvedValueOnce({
      data: [{ ...CONTACT_FIXTURE, total_value: '5000.50' }],
      count: 1,
      error: null,
    })

    // Act
    const res = await GET(makeGetRequest('http://localhost/api/public/v1/contacts'))
    const body = await res.json()

    // Assert
    expect(typeof body.data[0].total_value).toBe('number')
    expect(body.data[0].total_value).toBe(5000.5)
  })

  it('filtra por email passando eq na query', async () => {
    // Act
    await GET(makeGetRequest('http://localhost/api/public/v1/contacts?email=maria@exemplo.com'))

    // Assert
    expect(contactQueryBuilder.eq).toHaveBeenCalledWith('email', expect.stringContaining('maria'))
  })

  it('sempre filtra por organization_id (isolamento multi-tenant)', async () => {
    // Act
    await GET(makeGetRequest('http://localhost/api/public/v1/contacts'))

    // Assert
    expect(contactQueryBuilder.eq).toHaveBeenCalledWith('organization_id', ORG_ID)
  })

  it('retorna nextCursor quando há mais itens que o limit', async () => {
    // Arrange — 100 itens, page de 50
    const items = Array.from({ length: 50 }, (_, i) => ({ ...CONTACT_FIXTURE, id: `c-${i}` }))
    contactQueryBuilder.range.mockResolvedValueOnce({ data: items, count: 100, error: null })

    // Act
    const res = await GET(makeGetRequest('http://localhost/api/public/v1/contacts'))
    const body = await res.json()

    // Assert
    expect(body.nextCursor).not.toBeNull()
  })

  it('retorna 500 quando banco retorna erro', async () => {
    // Arrange
    contactQueryBuilder.range.mockResolvedValueOnce({
      data: null,
      count: null,
      error: { message: 'db error' },
    })

    // Act
    const res = await GET(makeGetRequest('http://localhost/api/public/v1/contacts'))
    const body = await res.json()

    // Assert
    expect(res.status).toBe(500)
    expect(body.code).toBe('DB_ERROR')
  })
})

// ---------------------------------------------------------------------------
// Testes POST (upsert)
// ---------------------------------------------------------------------------
describe('POST /api/public/v1/contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authPublicApi).mockResolvedValue(AUTH_OK)
    // Default: contato não existe → cria novo
    contactQueryBuilder.maybeSingle.mockResolvedValue({ data: null, error: null })
    contactQueryBuilder.single.mockResolvedValue({ data: CONTACT_FIXTURE, error: null })
  })

  it('cria contato novo quando email não existe (happy path)', async () => {
    // Arrange
    const payload = {
      name: 'João Novo',
      email: 'joao@exemplo.com',
    }

    // Act
    const res = await POST(makePostRequest(payload))
    const body = await res.json()

    // Assert
    expect(res.status).toBe(201)
    expect(body.action).toBe('created')
    expect(body.data).toBeDefined()
  })

  it('atualiza contato existente (upsert)', async () => {
    // Arrange — contato já existe
    contactQueryBuilder.maybeSingle.mockResolvedValueOnce({
      data: { id: CONTACT_ID },
      error: null,
    })
    contactQueryBuilder.single.mockResolvedValueOnce({
      data: { ...CONTACT_FIXTURE, name: 'Maria Atualizada' },
      error: null,
    })
    const payload = { email: 'maria@exemplo.com', name: 'Maria Atualizada' }

    // Act
    const res = await POST(makePostRequest(payload))
    const body = await res.json()

    // Assert
    expect(res.status).toBe(200)
    expect(body.action).toBe('updated')
    expect(contactQueryBuilder.update).toHaveBeenCalled()
  })

  it('retorna 422 quando nem email nem phone fornecidos', async () => {
    // Arrange
    const payload = { name: 'Sem Contato' }

    // Act
    const res = await POST(makePostRequest(payload))
    const body = await res.json()

    // Assert
    expect(res.status).toBe(422)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.error).toMatch(/email|phone/i)
  })

  it('retorna 422 ao criar contato novo sem nome', async () => {
    // Arrange — contato não existe, nome não fornecido
    const payload = { email: 'sem-nome@exemplo.com' }

    // Act
    const res = await POST(makePostRequest(payload))
    const body = await res.json()

    // Assert
    expect(res.status).toBe(422)
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  it('retorna 422 com birth_date inválido', async () => {
    // Arrange
    const payload = {
      name: 'Test',
      email: 'test@example.com',
      birth_date: 'nao-e-uma-data',
    }

    // Act
    const res = await POST(makePostRequest(payload))
    const body = await res.json()

    // Assert
    expect(res.status).toBe(422)
    expect(body.error).toMatch(/birth_date/i)
  })

  it('retorna 422 com last_interaction inválido', async () => {
    // Arrange
    const payload = {
      name: 'Test',
      email: 'test@example.com',
      last_interaction: 'data-invalida',
    }

    // Act
    const res = await POST(makePostRequest(payload))
    const body = await res.json()

    // Assert
    expect(res.status).toBe(422)
    expect(body.error).toMatch(/last_interaction/i)
  })

  it('aceita birth_date no formato YYYY-MM-DD sem rejeitar', async () => {
    // Arrange
    const payload = {
      name: 'Test',
      email: 'test@example.com',
      birth_date: '1990-05-15',
    }

    // Act
    const res = await POST(makePostRequest(payload))

    // Assert
    expect(res.status).toBe(201)
  })

  it('resolve company_name para client_company_id automaticamente', async () => {
    // Arrange — company não existe, será criada
    companyQueryBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const payload = {
      name: 'Test',
      email: 'test@example.com',
      company_name: 'Empresa Nova LTDA',
    }

    // Act
    await POST(makePostRequest(payload))

    // Assert
    expect(supabaseMock.from).toHaveBeenCalledWith('crm_companies')
    expect(companyQueryBuilder.insert).toHaveBeenCalled()
  })

  it('retorna 401 quando auth falha', async () => {
    // Arrange
    vi.mocked(authPublicApi).mockResolvedValue({
      ok: false,
      status: 401,
      body: { error: 'Invalid API key', code: 'AUTH_INVALID' },
    })

    // Act
    const res = await POST(makePostRequest({ name: 'X', email: 'x@example.com' }))
    const body = await res.json()

    // Assert
    expect(res.status).toBe(401)
    expect(body.code).toBe('AUTH_INVALID')
  })

  it('garante que organization_id é injetado no insert (multi-tenant)', async () => {
    // Act
    await POST(makePostRequest({ name: 'Multi', email: 'multi@example.com' }))

    // Assert
    expect(contactQueryBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: ORG_ID,
      })
    )
  })

  it('grava custom_fields enviados pelo integrador', async () => {
    // Act
    await POST(
      makePostRequest({
        name: 'Form Lead',
        email: 'form@example.com',
        custom_fields: { origemFormulario: 'Landing Page', interesse: 'Mulheres Livres' },
      })
    )

    // Assert
    expect(contactQueryBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        custom_fields: { origemFormulario: 'Landing Page', interesse: 'Mulheres Livres' },
      })
    )
  })

  it('normaliza custom_fields conforme o tipo da definição', async () => {
    // Act — booleano e monetário chegam como tipos nativos do JSON
    await POST(
      makePostRequest({
        name: 'Form Lead',
        email: 'form@example.com',
        custom_fields: { aceitaContato: true, valorPlano: 1997.9, dataAula: '2026-07-27' },
      })
    )

    // Assert — gravados no formato canônico, sempre string
    expect(contactQueryBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        custom_fields: { aceitaContato: 'true', valorPlano: '1997.9', dataAula: '2026-07-27' },
      })
    )
  })

  it('rejeita chave de campo personalizado sem definição cadastrada', async () => {
    // Act
    const res = await POST(
      makePostRequest({
        name: 'Form Lead',
        email: 'form@example.com',
        custom_fields: { campoQueNaoExiste: 'x' },
      })
    )
    const body = await res.json()

    // Assert — falhar alto é melhor que gravar dado invisível na interface
    expect(res.status).toBe(422)
    expect(body.code).toBe('UNKNOWN_CUSTOM_FIELD')
    expect(body.error).toContain('campoQueNaoExiste')
    expect(contactQueryBuilder.insert).not.toHaveBeenCalled()
  })

  it('tags_add acrescenta etiquetas sem apagar as existentes', async () => {
    // Act
    const res = await POST(
      makePostRequest({
        name: 'Form Lead',
        email: 'form@example.com',
        tags_add: ['Instagram'],
      })
    )
    const body = await res.json()

    // Assert
    expect(contactTagsQueryBuilder.upsert).toHaveBeenCalled()
    // O caminho destrutivo não pode ser acionado por tags_add.
    expect(contactTagsQueryBuilder.delete).not.toHaveBeenCalled()
    expect(body.data.tags).toEqual(['Instagram'])
  })

  it('tags substitui a lista inteira de etiquetas', async () => {
    // Act
    await POST(
      makePostRequest({
        name: 'Form Lead',
        email: 'form@example.com',
        tags: ['Instagram'],
      })
    )

    // Assert
    expect(contactTagsQueryBuilder.delete).toHaveBeenCalled()
    expect(contactTagsQueryBuilder.insert).toHaveBeenCalled()
  })

  it('não toca em etiquetas quando o payload não menciona tags', async () => {
    // Act
    await POST(makePostRequest({ name: 'Sem Tags', email: 'semtags@example.com' }))

    // Assert
    expect(contactTagsQueryBuilder.delete).not.toHaveBeenCalled()
    expect(contactTagsQueryBuilder.insert).not.toHaveBeenCalled()
    expect(contactTagsQueryBuilder.upsert).not.toHaveBeenCalled()
  })

  it('respeita stage e status enviados ao criar, em vez de forçar LEAD/ACTIVE', async () => {
    // Act
    await POST(
      makePostRequest({
        name: 'Cliente',
        email: 'cliente@example.com',
        status: 'INACTIVE',
        stage: 'CUSTOMER',
      })
    )

    // Assert
    expect(contactQueryBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'INACTIVE', stage: 'CUSTOMER' })
    )
  })

  it('retorna 422 com payload que tem campo extra (strict schema)', async () => {
    // Arrange
    const payload = {
      name: 'Test',
      email: 'test@example.com',
      campo_nao_permitido: 'valor',
    }

    // Act
    const res = await POST(makePostRequest(payload))
    const body = await res.json()

    // Assert
    expect(res.status).toBe(422)
    expect(body.code).toBe('VALIDATION_ERROR')
  })
})
