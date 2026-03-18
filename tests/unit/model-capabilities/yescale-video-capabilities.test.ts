import { describe, expect, it } from 'vitest'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'

describe('yescale video capabilities catalog', () => {
  it('registers veo 3.1 as normal and firstlastframe capable', () => {
    const capabilities = findBuiltinCapabilities('video', 'yescale', 'veo-3.1')

    expect(capabilities?.video?.generationModeOptions).toEqual(['normal', 'firstlastframe'])
    expect(capabilities?.video?.firstlastframe).toBe(true)
  })
})