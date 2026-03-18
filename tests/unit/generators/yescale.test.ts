import { describe, expect, it } from 'vitest'
import { buildYeScaleAudioSpeechPayload, buildYeScaleGeminiTtsPayload, buildYeScaleImageSubmitPayload, buildYeScaleVideoSubmitPayload } from '@/lib/generators/yescale'

describe('yescale generator payload builders', () => {
  it('fills required nano banana 2 defaults when caller omits google search and thinking', () => {
    const payload = buildYeScaleImageSubmitPayload({
      modelId: 'nano-banana-2',
      prompt: 'draw cat',
      options: { resolution: '16:9' },
    })

    expect(payload).toEqual({
      model: 'nano-banana-2',
      prompt: 'draw cat',
      config: {
        aspect_ratio: '16:9',
        size: '1K',
        google_search: 'disable',
        thinking: 'minimal',
      },
    })
  })

  it('builds nano banana 2 image payload from aspect-ratio style resolution', () => {
    const payload = buildYeScaleImageSubmitPayload({
      modelId: 'nano-banana-2',
      prompt: 'draw cat',
      referenceImages: ['https://example.com/ref.png'],
      options: { resolution: '16:9', googleSearch: 'both', thinking: 'high' },
    })

    expect(payload).toEqual({
      model: 'nano-banana-2',
      prompt: 'draw cat',
      config: {
        aspect_ratio: '16:9',
        size: '1K',
        google_search: 'both',
        thinking: 'high',
        images: ['https://example.com/ref.png'],
      },
    })
  })

  it('accepts snake_case nano banana 2 options from normalized runtime selections', () => {
    const payload = buildYeScaleImageSubmitPayload({
      modelId: 'nano-banana-2',
      prompt: 'draw cat',
      options: { resolution: '9:16', google_search: 'both' },
    })

    expect(payload).toEqual({
      model: 'nano-banana-2',
      prompt: 'draw cat',
      config: {
        aspect_ratio: '9:16',
        size: '1K',
        google_search: 'both',
        thinking: 'minimal',
      },
    })
  })

  it('maps legacy nano banana 2 thinking values to provider-supported values', () => {
    const payload = buildYeScaleImageSubmitPayload({
      modelId: 'nano-banana-2',
      prompt: 'draw cat',
      options: { resolution: '1:1', thinking: 'medium' },
    })

    expect(payload).toEqual({
      model: 'nano-banana-2',
      prompt: 'draw cat',
      config: {
        aspect_ratio: '1:1',
        size: '1K',
        google_search: 'disable',
        thinking: 'minimal',
      },
    })
  })

  it('builds hailuo video payload from size-style resolution', () => {
    const payload = buildYeScaleVideoSubmitPayload({
      modelId: 'hailuo-2.3',
      prompt: 'animate this',
      imageUrl: 'https://example.com/source.png',
      options: { duration: 10, resolution: '1080P' },
    })

    expect(payload).toEqual({
      model: 'hailuo-2.3',
      prompt: 'animate this',
      config: {
        duration: 10,
        size: '1080P',
        images: ['https://example.com/source.png'],
      },
    })
  })

  it('builds yescale audio speech payload with default voice and rate normalization', () => {
    const payload = buildYeScaleAudioSpeechPayload({
      modelId: 'gpt-4o-mini-tts',
      text: 'hello',
      options: { rate: '+20%' },
    })

    expect(payload).toEqual({
      model: 'gpt-4o-mini-tts',
      input: 'hello',
      voice: 'alloy',
      response_format: 'mp3',
      speed: 1.2,
    })
  })

  it('builds yescale audio speech payload with explicit voice', () => {
    const payload = buildYeScaleAudioSpeechPayload({
      modelId: 'tts-1',
      text: 'hello',
      options: { voice: 'sage', rate: 1.5 },
    })

    expect(payload).toEqual({
      model: 'tts-1',
      input: 'hello',
      voice: 'sage',
      response_format: 'mp3',
      speed: 1.5,
    })
  })

  it('builds yescale Gemini TTS payload with multi-speaker voice config', () => {
    const payload = buildYeScaleGeminiTtsPayload({
      modelId: 'gemini-2.5-flash-preview-tts',
      text: 'Xin chao',
      options: {
        voice: 'Kore',
        speakerName: 'Joe',
      },
    })

    expect(payload).toEqual({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [
        {
          parts: [{ text: 'Joe: Xin chao' }],
        },
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              {
                speaker: 'Joe',
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: 'Kore',
                  },
                },
              },
            ],
          },
        },
      },
    })
  })

  it('builds veo 3.1 video payload for first-last-frame mode', () => {
    const payload = buildYeScaleVideoSubmitPayload({
      modelId: 'veo-3.1',
      prompt: 'animate storefront transition',
      imageUrl: 'https://example.com/first.png',
      options: {
        resolution: '16:9',
        lastFrameImageUrl: 'https://example.com/last.png',
        enhancePrompt: true,
      },
    })

    expect(payload).toEqual({
      model: 'veo-3.1',
      prompt: 'animate storefront transition',
      config: {
        images: [
          'https://example.com/first.png',
          'https://example.com/last.png',
        ],
        aspect_ratio: '16:9',
        enhance_prompt: true,
      },
    })
  })

  it('rejects first-last-frame input for unsupported yescale video models', () => {
    expect(() => buildYeScaleVideoSubmitPayload({
      modelId: 'kling-2.5-turbo',
      prompt: 'animate this',
      imageUrl: 'https://example.com/source.png',
      options: {
        lastFrameImageUrl: 'https://example.com/last.png',
      },
    })).toThrow('YESCALE_VIDEO_OPTION_UNSUPPORTED: lastFrameImageUrl for kling-2.5-turbo')
  })
})