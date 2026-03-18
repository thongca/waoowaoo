import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(async () => ({
      customModels: JSON.stringify([
        {
          modelId: 'qwen3-tts-vd-2026-01-26',
          modelKey: 'bailian::qwen3-tts-vd-2026-01-26',
          name: 'Qwen3 TTS',
          type: 'audio',
          provider: 'bailian',
        },
        {
          modelId: 'qwen-voice-design',
          modelKey: 'bailian::qwen-voice-design',
          name: 'Qwen Voice Design',
          type: 'audio',
          provider: 'bailian',
        },
      ]),
      customProviders: JSON.stringify([
        {
          id: 'bailian',
          name: 'Alibaba Bailian',
          apiKey: 'k-bailian',
        },
      ]),
    })),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/model-capabilities/catalog', () => ({
  findBuiltinCapabilities: vi.fn(() => undefined),
}))
vi.mock('@/lib/model-pricing/catalog', () => ({
  findBuiltinPricingCatalogEntry: vi.fn(() => undefined),
}))

describe('api specific - user models audio filter', () => {
  const routeContext = { params: Promise.resolve({}) }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('excludes voice design models from the audio model list', async () => {
    const mod = await import('@/app/api/user/models/route')
    const req = buildMockRequest({
      path: '/api/user/models',
      method: 'GET',
    })
    const res = await mod.GET(req, routeContext)

    expect(res.status).toBe(200)
    const body = await res.json() as { audio: Array<{ value: string }> }
    expect(body.audio.map((item) => item.value)).toEqual([
      'bailian::qwen3-tts-vd-2026-01-26',
    ])
  })

  it('includes models for providers configured only with api key groups', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      customModels: JSON.stringify([
        {
          modelId: 'gpt-5-mini',
          modelKey: 'yescale::gpt-5-mini',
          name: 'GPT-5 mini',
          type: 'llm',
          provider: 'yescale',
        },
      ]),
      customProviders: JSON.stringify([
        {
          id: 'yescale',
          name: 'YEScale',
          apiKeyGroups: {
            openai: 'k-yescale-openai',
          },
        },
      ]),
    })

    const mod = await import('@/app/api/user/models/route')
    const req = buildMockRequest({
      path: '/api/user/models',
      method: 'GET',
    })
    const res = await mod.GET(req, routeContext)

    expect(res.status).toBe(200)
    const body = await res.json() as { llm: Array<{ value: string; label: string; provider: string; providerName: string }> }
    expect(body.llm).toEqual([
      {
        value: 'yescale::gpt-5-mini',
        label: 'GPT-5 mini',
        provider: 'yescale',
        providerName: 'YEScale',
      },
    ])
  })

  it('returns only active models', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      customModels: JSON.stringify([
        {
          modelId: 'gpt-5-mini',
          modelKey: 'yescale::gpt-5-mini',
          name: 'GPT-5 mini',
          type: 'llm',
          provider: 'yescale',
          enabled: true,
        },
        {
          modelId: 'gpt-5',
          modelKey: 'yescale::gpt-5',
          name: 'GPT-5',
          type: 'llm',
          provider: 'yescale',
          enabled: false,
        },
      ]),
      customProviders: JSON.stringify([
        {
          id: 'yescale',
          name: 'YEScale',
          apiKeyGroups: {
            openai: 'k-yescale-openai',
          },
        },
      ]),
    })

    const mod = await import('@/app/api/user/models/route')
    const req = buildMockRequest({
      path: '/api/user/models',
      method: 'GET',
    })
    const res = await mod.GET(req, routeContext)

    expect(res.status).toBe(200)
    const body = await res.json() as { llm: Array<{ value: string }> }
    expect(body.llm.map((item) => item.value)).toEqual([
      'yescale::gpt-5-mini',
    ])
  })
})
