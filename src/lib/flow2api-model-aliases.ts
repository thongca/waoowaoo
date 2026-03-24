import type { UnifiedModelType } from '@/lib/model-config-contract'

type ApiModelType = UnifiedModelType | 'text' | 'voice' | 'voice-design' | 'lip-sync'

const IMAGE_RUNTIME_MODEL_BY_CANONICAL_ID: Record<string, string> = {
  'gemini-3-pro-image-preview': 'gemini-3.0-pro-image',
}

const IMAGE_CANONICAL_MODEL_BY_RUNTIME_ID: Record<string, string> = Object.fromEntries(
  Object.entries(IMAGE_RUNTIME_MODEL_BY_CANONICAL_ID).map(([canonicalId, runtimeId]) => [runtimeId, canonicalId]),
)

function normalizeProviderKey(providerId: string): string {
  const trimmed = providerId.trim().toLowerCase()
  if (!trimmed) return ''
  const separatorIndex = trimmed.indexOf(':')
  return separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex)
}

function isFlow2ApiStyleProvider(providerId: string): boolean {
  const providerKey = normalizeProviderKey(providerId)
  return providerKey === 'gemini-compatible' || providerKey === 'openai-compatible' || providerKey === 'flow2api'
}

export function resolveFlow2ApiImageRuntimeModelId(modelId: string): string {
  const normalizedModelId = modelId.trim()
  return IMAGE_RUNTIME_MODEL_BY_CANONICAL_ID[normalizedModelId] || normalizedModelId
}

export function resolveFlow2ApiVideoRuntimeModelId(modelId: string): string {
  return modelId.trim()
}

export function resolveFlow2ApiCanonicalModelId(modelType: ApiModelType, modelId: string): string {
  const normalizedModelId = modelId.trim()
  if (modelType === 'image') {
    return IMAGE_CANONICAL_MODEL_BY_RUNTIME_ID[normalizedModelId] || normalizedModelId
  }
  return normalizedModelId
}

export function formatFlow2ApiDisplayLabel(input: {
  modelType: UnifiedModelType
  providerId: string
  modelId: string
  label: string
}): string {
  const baseLabel = input.label.trim() || input.modelId.trim()
  if (!isFlow2ApiStyleProvider(input.providerId)) {
    return baseLabel
  }

  const canonicalModelId = resolveFlow2ApiCanonicalModelId(input.modelType, input.modelId)
  if (!canonicalModelId || canonicalModelId === input.modelId.trim()) {
    return baseLabel
  }

  if (baseLabel === input.modelId.trim()) {
    return canonicalModelId
  }

  return baseLabel
}