import { describe, expect, it } from 'vitest'
import { VERIFIABLE_PROVIDER_KEYS } from '@/app/[locale]/profile/components/api-config/provider-card/types'

describe('provider card provider capabilities', () => {
  it('marks yescale as verifiable so test connection button can render', () => {
    expect(VERIFIABLE_PROVIDER_KEYS.has('yescale')).toBe(true)
  })
})