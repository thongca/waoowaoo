import { getProviderKey } from '@/lib/api-config'

/** Returns true if the provider is a Flow2API instance (key === 'flow2api'). */
export function isFlow2ApiProvider(providerId: string): boolean {
  return getProviderKey(providerId).toLowerCase() === 'flow2api'
}
