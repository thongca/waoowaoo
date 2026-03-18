import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1', mode: 'novel-promotion' },
  })),
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findUnique: vi.fn(async () => ({
      audioModel: 'yescale::gpt-4o-mini-tts',
    })),
  },
  userPreference: {
    findUnique: vi.fn(async () => ({
      audioModel: 'yescale::gpt-4o-mini-tts',
    })),
  },
}))

const submitTaskMock = vi.hoisted(() => vi.fn())

const validateVoicePromptMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => { valid: boolean; error?: string }>(() => ({ valid: true })))
const validatePreviewTextMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => { valid: boolean; error?: string }>(() => ({ valid: true })))

const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelectionOrSingle: vi.fn(async (_userId: string, model: string | null | undefined) => {
    const modelKey = typeof model === 'string' ? model : 'yescale::gpt-4o-mini-tts'
    const separator = modelKey.indexOf('::')
    const provider = separator === -1 ? modelKey : modelKey.slice(0, separator)
    const modelId = separator === -1 ? modelKey : modelKey.slice(separator + 2)
    return {
      provider,
      modelId,
      modelKey,
      mediaType: 'audio',
    }
  }),
  getProviderKey: vi.fn((providerId: string) => providerId),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/billing', () => ({
  buildDefaultTaskBillingInfo: vi.fn(() => ({ mode: 'default' })),
}))
vi.mock('@/lib/providers/bailian/voice-design', () => ({
  validateVoicePrompt: validateVoicePromptMock,
  validatePreviewText: validatePreviewTextMock,
}))

describe('api specific - voice design provider guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      audioModel: 'yescale::gpt-4o-mini-tts',
    })
    prismaMock.userPreference.findUnique.mockResolvedValue({
      audioModel: 'yescale::gpt-4o-mini-tts',
    })
    validateVoicePromptMock.mockReturnValue({ valid: true })
    validatePreviewTextMock.mockReturnValue({ valid: true })
  })

  it('rejects project voice design when active audio provider is not Bailian', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/voice-design/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/voice-design',
      method: 'POST',
      body: {
        voicePrompt: 'warm narrator',
        previewText: 'This is a valid preview sentence.',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(400)
    expect(submitTaskMock).not.toHaveBeenCalled()

    const json = await res.json()
    expect(json.error?.message).toBe(
      'Design AI currently only supports Bailian voice design. Switch the active audio model to a Bailian voice model and try again.',
    )
  })

  it('rejects asset hub voice design when active audio provider is not Bailian', async () => {
    const mod = await import('@/app/api/asset-hub/voice-design/route')
    const req = buildMockRequest({
      path: '/api/asset-hub/voice-design',
      method: 'POST',
      body: {
        voicePrompt: 'warm narrator',
        previewText: 'This is a valid preview sentence.',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    expect(submitTaskMock).not.toHaveBeenCalled()

    const json = await res.json()
    expect(json.error?.message).toBe(
      'Design AI currently only supports Bailian voice design. Switch the active audio model to a Bailian voice model and try again.',
    )
  })

  it('returns validation detail for invalid preview text on Bailian', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      audioModel: 'bailian::qwen-voice-design',
    })
    prismaMock.userPreference.findUnique.mockResolvedValue({
      audioModel: 'bailian::qwen-voice-design',
    })
    validatePreviewTextMock.mockReturnValue({ valid: false, error: 'Preview text must be at least 5 characters' })

    const mod = await import('@/app/api/novel-promotion/[projectId]/voice-design/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/voice-design',
      method: 'POST',
      body: {
        voicePrompt: 'warm narrator',
        previewText: 'hey',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(400)
    expect(submitTaskMock).not.toHaveBeenCalled()

    const json = await res.json()
    expect(json.error?.message).toBe('Preview text must be at least 5 characters')
  })
})