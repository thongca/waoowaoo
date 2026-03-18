import { describe, expect, it } from 'vitest'
import {
  type CapabilitySelections,
  type ModelCapabilities,
  type UnifiedModelType,
} from '@/lib/model-config-contract'
import { resolveGenerationOptionsForModel } from '@/lib/model-capabilities/lookup'

describe('model-capabilities/lookup - image resolution defaulting', () => {
  const modelType: UnifiedModelType = 'image'
  const modelKey = 'google::test-image-model'

  const capabilities: ModelCapabilities = {
    image: {
      resolutionOptions: ['0.5K', '1K', '2K'],
    },
  }

  it('auto-fills resolution with first option when missing and required', () => {
    const capabilityDefaults: CapabilitySelections = {}

    const result = resolveGenerationOptionsForModel({
      modelType,
      modelKey,
      capabilities,
      capabilityDefaults,
      requireAllFields: true,
    })

    expect(result.issues).toEqual([])
    expect(result.options).toEqual({
      resolution: '0.5K',
    })
  })

  it('does not override user-provided resolution', () => {
    const capabilityDefaults: CapabilitySelections = {
      [modelKey]: {
        resolution: '2K',
      },
    }

    const result = resolveGenerationOptionsForModel({
      modelType,
      modelKey,
      capabilities,
      capabilityDefaults,
      requireAllFields: true,
    })

    expect(result.issues).toEqual([])
    expect(result.options).toEqual({
      resolution: '2K',
    })
  })

  it('auto-fills every required image field from the first catalog option', () => {
    const result = resolveGenerationOptionsForModel({
      modelType,
      modelKey,
      capabilities: {
        image: {
          resolutionOptions: ['1:1', '16:9'],
          google_searchOptions: ['disable', 'both'],
          thinkingOptions: ['minimal', 'high'],
        },
      },
      capabilityDefaults: {},
      requireAllFields: true,
    })

    expect(result.issues).toEqual([])
    expect(result.options).toEqual({
      resolution: '1:1',
      google_search: 'disable',
      thinking: 'minimal',
    })
  })

  it('normalizes legacy thinking selections to the supported catalog value', () => {
    const result = resolveGenerationOptionsForModel({
      modelType,
      modelKey: 'yescale::nano-banana-2',
      capabilities: {
        image: {
          resolutionOptions: ['1:1', '16:9'],
          google_searchOptions: ['disable', 'both'],
          thinkingOptions: ['minimal', 'high'],
        },
      },
      capabilityDefaults: {
        'yescale::nano-banana-2': {
          resolution: '16:9',
          google_search: 'both',
          thinking: 'medium',
        },
      },
      requireAllFields: true,
    })

    expect(result.issues).toEqual([])
    expect(result.options).toEqual({
      resolution: '16:9',
      google_search: 'both',
      thinking: 'minimal',
    })
  })
})

