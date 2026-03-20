import { describe, expect, it } from 'vitest'
import {
  formatFlow2ApiDisplayLabel,
  resolveFlow2ApiCanonicalModelId,
  resolveFlow2ApiImageRuntimeModelId,
  resolveFlow2ApiVideoRuntimeModelId,
} from '@/lib/flow2api-model-aliases'

describe('regression - flow2api model aliases', () => {
  it('maps canonical image preview ids to runtime ids and back', () => {
    expect(resolveFlow2ApiImageRuntimeModelId('gemini-3-pro-image-preview')).toBe('gemini-3.0-pro-image')
    expect(resolveFlow2ApiCanonicalModelId('image', 'gemini-3.0-pro-image')).toBe('gemini-3-pro-image-preview')
  })

  it('preserves video runtime ids for flow2api-compatible models', () => {
    expect(resolveFlow2ApiVideoRuntimeModelId('veo_3_1_r2v_fast_portrait')).toBe('veo_3_1_r2v_fast_portrait')
  })

  it('formats fallback labels with canonical ids for flow2api-style providers', () => {
    expect(formatFlow2ApiDisplayLabel({
      modelType: 'image',
      providerId: 'gemini-compatible:provider-1',
      modelId: 'gemini-3.0-pro-image',
      label: 'gemini-3.0-pro-image',
    })).toBe('gemini-3-pro-image-preview')

    expect(formatFlow2ApiDisplayLabel({
      modelType: 'image',
      providerId: 'google',
      modelId: 'gemini-3.0-pro-image',
      label: 'gemini-3.0-pro-image',
    })).toBe('gemini-3.0-pro-image')
  })
})