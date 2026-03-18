import { describe, expect, it } from 'vitest'
import {
  getAddableModelTypesForProvider,
  getVisibleModelTypesForProvider,
  shouldShowOpenAICompatVideoHint,
} from '@/app/[locale]/profile/components/api-config/provider-card/ProviderAdvancedFields'
import {
  buildCustomPricingFromModelForm,
  buildProviderConnectionPayload,
  resolveProviderConnectionTestApiKey,
} from '@/app/[locale]/profile/components/api-config/provider-card/hooks/useProviderCardState'
import { buildModelsForSave } from '@/app/[locale]/profile/components/api-config/hooks'
import type { CustomModel } from '@/app/[locale]/profile/components/api-config/types'

describe('provider card pricing form behavior', () => {
  it('allows openai-compatible provider to add llm/image/video', () => {
    expect(getAddableModelTypesForProvider('openai-compatible:oa-1')).toEqual(['llm', 'image', 'video'])
  })

  it('allows yescale provider to add llm/image/video/audio', () => {
    expect(getAddableModelTypesForProvider('yescale')).toEqual(['llm', 'image', 'video', 'audio'])
  })

  it('builds preset provider connection payload for yescale without requiring baseUrl', () => {
    expect(
      buildProviderConnectionPayload({
        providerKey: 'yescale',
        apiKey: '',
        apiKeyGroups: { openai: 'ys-key' },
        llmModel: 'gpt-4o',
      }),
    ).toEqual({
      apiType: 'yescale',
      apiKey: 'ys-key',
      llmModel: 'gpt-4o',
    })
  })

  it('resolves yescale test api key from the model default group first', () => {
    expect(
      resolveProviderConnectionTestApiKey({
        providerKey: 'yescale',
        apiKeyGroups: {
          premium: 'premium-key',
          openai: 'openai-key',
        },
        llmModel: 'gpt-4o',
      }),
    ).toBe('openai-key')
  })

  it('falls back to the first configured yescale group when the preferred group is missing', () => {
    expect(
      resolveProviderConnectionTestApiKey({
        providerKey: 'yescale',
        apiKeyGroups: {
          video: 'video-key',
        },
        llmModel: 'gpt-4o',
      }),
    ).toBe('video-key')
  })

  it('resolves YEScale Gemini TTS models to the gemini-op group first', () => {
    expect(
      resolveProviderConnectionTestApiKey({
        providerKey: 'yescale',
        apiKeyGroups: {
          'gemini-op': 'gemini-op-key',
          openai: 'openai-key',
        },
        llmModel: 'gemini-2.5-flash-preview-tts',
      }),
    ).toBe('gemini-op-key')
  })

  it('shows llm/image/video tabs by default for openai-compatible even with only image models', () => {
    const visible = getVisibleModelTypesForProvider(
      'openai-compatible:oa-1',
      {
        image: [
          {
            modelId: 'gpt-image-1',
            modelKey: 'openai-compatible:oa-1::gpt-image-1',
            name: 'Image',
            type: 'image',
            provider: 'openai-compatible:oa-1',
            price: 0,
            enabled: true,
          },
        ],
      },
    )

    expect(visible).toEqual(['llm', 'image', 'video'])
  })

  it('shows the openai-compatible video hint only for openai-compatible video add forms', () => {
    expect(shouldShowOpenAICompatVideoHint('openai-compatible:oa-1', 'video')).toBe(true)
    expect(shouldShowOpenAICompatVideoHint('openai-compatible:oa-1', 'image')).toBe(false)
    expect(shouldShowOpenAICompatVideoHint('gemini-compatible:gm-1', 'video')).toBe(false)
    expect(shouldShowOpenAICompatVideoHint('ark', 'video')).toBe(false)
  })

  it('keeps payload without customPricing when pricing toggle is off', () => {
    const result = buildCustomPricingFromModelForm(
      'image',
      {
        name: 'Image',
        modelId: 'gpt-image-1',
        enableCustomPricing: false,
        basePrice: '0.8',
      },
      { needsCustomPricing: true },
    )

    expect(result).toEqual({ ok: true })
  })

  it('builds llm customPricing payload when pricing toggle is on', () => {
    const result = buildCustomPricingFromModelForm(
      'llm',
      {
        name: 'GPT',
        modelId: 'gpt-4.1',
        enableCustomPricing: true,
        priceInput: '2.5',
        priceOutput: '8',
      },
      { needsCustomPricing: true },
    )

    expect(result).toEqual({
      ok: true,
      customPricing: {
        llm: {
          inputPerMillion: 2.5,
          outputPerMillion: 8,
        },
      },
    })
  })

  it('builds media customPricing payload with option prices when enabled', () => {
    const result = buildCustomPricingFromModelForm(
      'video',
      {
        name: 'Sora',
        modelId: 'sora-2',
        enableCustomPricing: true,
        basePrice: '0.9',
        optionPricesJson: '{"resolution":{"720x1280":0.1},"duration":{"8":0.4}}',
      },
      { needsCustomPricing: true },
    )

    expect(result).toEqual({
      ok: true,
      customPricing: {
        video: {
          basePrice: 0.9,
          optionPrices: {
            resolution: {
              '720x1280': 0.1,
            },
            duration: {
              '8': 0.4,
            },
          },
        },
      },
    })
  })

  it('rejects invalid media optionPrices JSON when enabled', () => {
    const result = buildCustomPricingFromModelForm(
      'image',
      {
        name: 'Image',
        modelId: 'gpt-image-1',
        enableCustomPricing: true,
        basePrice: '0.3',
        optionPricesJson: '{"resolution":{"1024x1024":"free"}}',
      },
      { needsCustomPricing: true },
    )

    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('bugfix: includes baseUrl for openai-compatible provider connection test payload', () => {
    const payload = buildProviderConnectionPayload({
      providerKey: 'openai-compatible',
      apiKey: ' sk-test ',
      baseUrl: ' https://api.openai-proxy.example/v1 ',
    })

    expect(payload).toEqual({
      apiType: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai-proxy.example/v1',
    })
  })

  it('omits baseUrl for non-compatible provider connection test payload', () => {
    const payload = buildProviderConnectionPayload({
      providerKey: 'ark',
      apiKey: ' ark-key ',
      baseUrl: ' https://ignored.example/v1 ',
    })

    expect(payload).toEqual({
      apiType: 'ark',
      apiKey: 'ark-key',
    })
  })

  it('includes llmModel in provider connection test payload when configured', () => {
    const payload = buildProviderConnectionPayload({
      providerKey: 'openai-compatible',
      apiKey: ' sk-test ',
      baseUrl: ' https://compat.example.com/v1 ',
      llmModel: ' gpt-4.1-mini ',
    })

    expect(payload).toEqual({
      apiType: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://compat.example.com/v1',
      llmModel: 'gpt-4.1-mini',
    })
  })

  it('keeps disabled custom models in save payload while omitting disabled preset-like models', () => {
    const models: CustomModel[] = [
      {
        modelId: 'gpt-4o',
        modelKey: 'yescale::gpt-4o',
        name: 'GPT-4o',
        type: 'llm',
        provider: 'yescale',
        price: 0,
        enabled: false,
      },
      {
        modelId: 'my-custom-model',
        modelKey: 'yescale::my-custom-model',
        name: 'My Custom Model',
        type: 'llm',
        provider: 'yescale',
        price: 0,
        enabled: false,
      },
    ]

    expect(buildModelsForSave(models).map((model) => model.modelKey)).toEqual([
      'yescale::my-custom-model',
    ])
  })
})
