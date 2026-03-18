import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn<(...args: unknown[]) => Promise<{ customProviders: string; customModels: string } | null>>(async () => null),
  },
}))

const decryptApiKeyMock = vi.hoisted(() => vi.fn((value: string) => value.replace(/^enc:/, '')))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/crypto-utils', () => ({
  decryptApiKey: decryptApiKeyMock,
}))

import { getProviderConfig } from '@/lib/api-config'

describe('api-config YEScale key groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the default key group for a YEScale model', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      customProviders: JSON.stringify([
        {
          id: 'yescale',
          name: 'YEScale',
          apiKeyGroups: {
            openai: 'enc:ys-openai',
            premium: 'enc:ys-premium',
          },
        },
      ]),
      customModels: JSON.stringify([
        {
          modelId: 'gpt-4o',
          modelKey: 'yescale::gpt-4o',
          name: 'GPT-4o',
          type: 'llm',
          provider: 'yescale',
        },
      ]),
    })

    const config = await getProviderConfig('user-1', 'yescale', { modelId: 'gpt-4o' })

    expect(config.apiKey).toBe('ys-openai')
    expect(config.keyGroup).toBe('openai')
  })

  it('resolves newly added chatgpt models to the openai key group by default', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      customProviders: JSON.stringify([
        {
          id: 'yescale',
          name: 'YEScale',
          apiKeyGroups: {
            openai: 'enc:ys-openai',
          },
        },
      ]),
      customModels: JSON.stringify([
        {
          modelId: 'gpt-5-mini',
          modelKey: 'yescale::gpt-5-mini',
          name: 'GPT-5 Mini',
          type: 'llm',
          provider: 'yescale',
        },
      ]),
    })

    const config = await getProviderConfig('user-1', 'yescale', { modelId: 'gpt-5-mini' })

    expect(config.apiKey).toBe('ys-openai')
    expect(config.keyGroup).toBe('openai')
  })

  it('resolves Gemini TTS models to the gemini-op key group by default', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      customProviders: JSON.stringify([
        {
          id: 'yescale',
          name: 'YEScale',
          apiKeyGroups: {
            'gemini-op': 'enc:ys-gemini-op',
          },
        },
      ]),
      customModels: JSON.stringify([
        {
          modelId: 'gemini-2.5-flash-preview-tts',
          modelKey: 'yescale::gemini-2.5-flash-preview-tts',
          name: 'Gemini 2.5 Flash Preview TTS',
          type: 'audio',
          provider: 'yescale',
        },
      ]),
    })

    const config = await getProviderConfig('user-1', 'yescale', { modelId: 'gemini-2.5-flash-preview-tts' })

    expect(config.apiKey).toBe('ys-gemini-op')
    expect(config.keyGroup).toBe('gemini-op')
  })

  it('honors a model-level YEScale key group override', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      customProviders: JSON.stringify([
        {
          id: 'yescale',
          name: 'YEScale',
          apiKeyGroups: {
            openai: 'enc:ys-openai',
            normal: 'enc:ys-normal',
          },
        },
      ]),
      customModels: JSON.stringify([
        {
          modelId: 'gpt-4o',
          modelKey: 'yescale::gpt-4o',
          name: 'GPT-4o',
          type: 'llm',
          provider: 'yescale',
          keyGroup: 'normal',
        },
      ]),
    })

    const config = await getProviderConfig('user-1', 'yescale', { modelId: 'gpt-4o' })

    expect(config.apiKey).toBe('ys-normal')
    expect(config.keyGroup).toBe('normal')
  })

  it('falls back to the legacy single YEScale apiKey when the grouped key is missing', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      customProviders: JSON.stringify([
        {
          id: 'yescale',
          name: 'YEScale',
          apiKey: 'enc:ys-legacy',
          apiKeyGroups: {
            premium: 'enc:ys-premium',
          },
        },
      ]),
      customModels: JSON.stringify([
        {
          modelId: 'gpt-4o',
          modelKey: 'yescale::gpt-4o',
          name: 'GPT-4o',
          type: 'llm',
          provider: 'yescale',
        },
      ]),
    })

    const config = await getProviderConfig('user-1', 'yescale', { modelId: 'gpt-4o' })

    expect(config.apiKey).toBe('ys-legacy')
    expect(config.keyGroup).toBe('openai')
  })
})