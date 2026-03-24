import { describe, expect, it } from 'vitest'
import {
  formatFlow2ApiDisplayLabel,
  resolveFlow2ApiCanonicalModelId,
  resolveFlow2ApiImageRuntimeModelId,
  resolveFlow2ApiVideoRuntimeModelId,
} from '@/lib/flow2api-model-aliases'
import {
  isFlow2ApiImageCanonicalId,
  isFlow2ApiVideoCanonicalId,
  resolveFlow2ApiImageModelId,
  resolveFlow2ApiVideoModelId,
} from '@/lib/flow2api-model-resolver'

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

  it('resolves flow2api canonical image ids using aspect ratio and size selections', () => {
    expect(isFlow2ApiImageCanonicalId('gemini-3.1-flash-image')).toBe(true)
    expect(resolveFlow2ApiImageModelId('gemini-3.1-flash-image', '4:3', '2K')).toBe(
      'gemini-3.1-flash-image-four-three-2k',
    )
    expect(resolveFlow2ApiImageModelId('imagen-4.0-generate-preview', '9:16')).toBe(
      'imagen-4.0-generate-preview-portrait',
    )
  })

  it('resolves flow2api canonical video ids using provider generation modes', () => {
    expect(isFlow2ApiVideoCanonicalId('veo-3.1-fast')).toBe(true)
    expect(resolveFlow2ApiVideoModelId('veo-3.1-fast', 't2v', '16:9')).toBe(
      'veo_3_1_t2v_fast_landscape',
    )
    expect(resolveFlow2ApiVideoModelId('veo-3.1-fast', 'i2v', '9:16')).toBe(
      'veo_3_1_i2v_s_fast_portrait_fl',
    )
    expect(resolveFlow2ApiVideoModelId('veo-3.1', 'i2v', '16:9')).toBe(
      'veo_3_1_i2v_s_landscape',
    )
  })
})