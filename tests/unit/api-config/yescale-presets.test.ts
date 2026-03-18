import { describe, expect, it } from 'vitest'

import { PRESET_MODELS } from '@/app/[locale]/profile/components/api-config/types'

describe('YEScale llm presets', () => {
  it('includes added chatgpt llm models', () => {
    const yescaleLlmIds = PRESET_MODELS
      .filter((model) => model.provider === 'yescale' && model.type === 'llm')
      .map((model) => model.modelId)

    expect(yescaleLlmIds).toEqual(expect.arrayContaining([
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-5',
      'gpt-5-chat-latest',
      'gpt-5-mini',
    ]))
  })

  it('includes YEScale audio presets', () => {
    const yescaleAudioIds = PRESET_MODELS
      .filter((model) => model.provider === 'yescale' && model.type === 'audio')
      .map((model) => model.modelId)

    expect(yescaleAudioIds).toEqual(expect.arrayContaining([
      'gemini-2.5-flash-preview-tts',
      'gemini-2.5-pro-preview-tts',
      'gpt-4o-mini-tts',
      'tts-1',
      'tts-1-hd',
    ]))
  })
})