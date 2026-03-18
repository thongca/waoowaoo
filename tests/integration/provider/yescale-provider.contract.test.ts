import { describe, expect, it, vi } from 'vitest'

const getProviderKeyMock = vi.hoisted(() => vi.fn((providerId: string) => providerId))

vi.mock('@/lib/api-config', () => ({
  getProviderKey: getProviderKeyMock,
}))

import { isCompatibleProvider, resolveModelGatewayRoute } from '@/lib/model-gateway/router'

describe('provider contract - yescale gateway routing', () => {
  it('treats yescale as an openai-compatible gateway provider', () => {
    expect(isCompatibleProvider('yescale')).toBe(true)
    expect(resolveModelGatewayRoute('yescale')).toBe('openai-compat')
  })
})