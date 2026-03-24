import {
  parseModelKeyStrict,
  type CapabilitySelections,
  type CapabilityValue,
  type CapabilityOptionValue,
  type ModelCapabilities,
  type UnifiedModelType,
} from '@/lib/model-config-contract'
import { findBuiltinCapabilities, findBuiltinCapabilityCatalogEntry } from '@/lib/model-capabilities/catalog'

export type CapabilitySelectionValidationCode =
  | 'CAPABILITY_SELECTION_INVALID'
  | 'CAPABILITY_MODEL_UNSUPPORTED'
  | 'CAPABILITY_FIELD_INVALID'
  | 'CAPABILITY_VALUE_NOT_ALLOWED'
  | 'CAPABILITY_REQUIRED'

export interface CapabilitySelectionValidationIssue {
  code: CapabilitySelectionValidationCode
  field: string
  message: string
  allowedValues?: readonly CapabilityOptionValue[]
}

export interface CapabilityModelContext {
  modelType: UnifiedModelType
  capabilities?: ModelCapabilities
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isCapabilityValue(value: unknown): value is CapabilityValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

const CAPABILITY_VALUE_ALIASES: Record<string, Record<string, Record<string, CapabilityOptionValue>>> = {
  'yescale::nano-banana-2': {
    thinking: {
      low: 'minimal',
      medium: 'minimal',
    },
  },
  // flow2api video models use t2v/i2v/r2v mode names; map the internal 'normal'/'firstlastframe'
  // values produced by resolveVideoGenerationMode to the appropriate provider-specific modes.
  'flow2api::veo-3.1-fast': {
    generationMode: {
      normal: 't2v',
      firstlastframe: 'i2v',
    },
  },
  'flow2api::veo-3.1': {
    generationMode: {
      normal: 't2v',
      firstlastframe: 'i2v',
    },
  },
}

function getNamespaceCapabilities(
  modelType: UnifiedModelType,
  capabilities: ModelCapabilities | undefined,
): Record<string, unknown> | null {
  if (!capabilities) return null
  const namespace = capabilities[modelType]
  if (!namespace || !isRecord(namespace)) return null
  return namespace
}

export function getCapabilityOptionFields(
  modelType: UnifiedModelType,
  capabilities: ModelCapabilities | undefined,
): Record<string, readonly CapabilityOptionValue[]> {
  const namespace = getNamespaceCapabilities(modelType, capabilities)
  if (!namespace) return {}

  const fields: Record<string, readonly CapabilityOptionValue[]> = {}
  for (const [key, rawValue] of Object.entries(namespace)) {
    if (!key.endsWith('Options')) continue
    if (!Array.isArray(rawValue)) continue
    if (rawValue.length === 0) continue
    if (!rawValue.every((item) => isCapabilityValue(item))) continue
    const field = key.slice(0, -'Options'.length)
    fields[field] = rawValue as CapabilityOptionValue[]
  }
  return fields
}

function normalizeCapabilityOptionValue(
  modelKey: string,
  field: string,
  value: CapabilityValue,
  allowedValues: readonly CapabilityOptionValue[] | undefined,
): CapabilityValue {
  if (typeof value !== 'string' || !allowedValues) return value

  if (field === 'generationMode') {
    if (value === 'firstlastframe' && allowedValues.includes('i2v')) return 'i2v'
    if (value === 'normal' && allowedValues.includes('t2v')) return 't2v'
    if (value === 'i2v' && allowedValues.includes('firstlastframe')) return 'firstlastframe'
    if (value === 't2v' && allowedValues.includes('normal')) return 'normal'
  }

  const parsedModelKey = parseModelKeyStrict(modelKey)
  const providerKeyAlias = parsedModelKey
    ? CAPABILITY_VALUE_ALIASES[`${parsedModelKey.provider.split(':')[0]}::${parsedModelKey.modelId}`]
    : undefined
  const normalized = CAPABILITY_VALUE_ALIASES[modelKey]?.[field]?.[value]
    ?? providerKeyAlias?.[field]?.[value]
  if (normalized === undefined) return value
  return allowedValues.includes(normalized) ? normalized : value
}

export function normalizeCapabilitySelectionForModel(input: {
  modelKey: string
  modelType: UnifiedModelType
  capabilities?: ModelCapabilities
  selection?: Record<string, CapabilityValue> | null
}): Record<string, CapabilityValue> {
  const selection = input.selection || {}
  const optionFields = getCapabilityOptionFields(input.modelType, input.capabilities)
  const normalized: Record<string, CapabilityValue> = {}

  for (const [field, value] of Object.entries(selection)) {
    normalized[field] = normalizeCapabilityOptionValue(input.modelKey, field, value, optionFields[field])
  }

  return normalized
}

export function hasCapabilityOptions(
  modelType: UnifiedModelType,
  capabilities: ModelCapabilities | undefined,
): boolean {
  return Object.keys(getCapabilityOptionFields(modelType, capabilities)).length > 0
}

function normalizeSelectionRecord(
  value: unknown,
  field: string,
): { value: Record<string, CapabilityValue> | null; issues: CapabilitySelectionValidationIssue[] } {
  const issues: CapabilitySelectionValidationIssue[] = []
  if (value === undefined || value === null) {
    return { value: null, issues }
  }
  if (!isRecord(value)) {
    issues.push({
      code: 'CAPABILITY_SELECTION_INVALID',
      field,
      message: 'selection must be an object',
    })
    return { value: null, issues }
  }

  const normalized: Record<string, CapabilityValue> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!isCapabilityValue(raw)) {
      issues.push({
        code: 'CAPABILITY_SELECTION_INVALID',
        field: `${field}.${key}`,
        message: 'selection value must be string/number/boolean',
      })
      continue
    }
    normalized[key] = raw
  }
  return { value: normalized, issues }
}

export function validateCapabilitySelectionForModel(input: {
  modelKey: string
  modelType: UnifiedModelType
  capabilities?: ModelCapabilities
  selection?: Record<string, CapabilityValue> | null
  requireAllFields: boolean
}): CapabilitySelectionValidationIssue[] {
  const issues: CapabilitySelectionValidationIssue[] = []
  const optionFields = getCapabilityOptionFields(input.modelType, input.capabilities)
  const optionFieldNames = new Set(Object.keys(optionFields))
  const selection = normalizeCapabilitySelectionForModel(input)

  if (Object.keys(optionFields).length === 0) {
    if (Object.keys(selection).length > 0) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `capabilities.${input.modelKey}`,
        message: 'model has no configurable capability options',
      })
    }
    return issues
  }

  for (const [field, value] of Object.entries(selection)) {
    if (!optionFieldNames.has(field)) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `capabilities.${input.modelKey}.${field}`,
        message: `field ${field} is not supported by model ${input.modelKey}`,
      })
      continue
    }

    const allowedValues = optionFields[field]
    if (!allowedValues.includes(value)) {
      issues.push({
        code: 'CAPABILITY_VALUE_NOT_ALLOWED',
        field: `capabilities.${input.modelKey}.${field}`,
        message: `value ${String(value)} is not allowed`,
        allowedValues,
      })
    }
  }

  if (input.requireAllFields) {
    for (const field of Object.keys(optionFields)) {
      if (selection[field] === undefined) {
        issues.push({
          code: 'CAPABILITY_REQUIRED',
          field: `capabilities.${input.modelKey}.${field}`,
          message: `field ${field} is required for model ${input.modelKey}`,
          allowedValues: optionFields[field],
        })
      }
    }
  }

  return issues
}

export function validateCapabilitySelectionsPayload(
  selections: unknown,
  resolveModelContext: (modelKey: string) => CapabilityModelContext | null,
): CapabilitySelectionValidationIssue[] {
  const issues: CapabilitySelectionValidationIssue[] = []

  if (selections === undefined || selections === null) return issues
  if (!isRecord(selections)) {
    issues.push({
      code: 'CAPABILITY_SELECTION_INVALID',
      field: 'capabilitySelections',
      message: 'capability selections must be an object',
    })
    return issues
  }

  for (const [modelKey, rawSelection] of Object.entries(selections)) {
    if (!parseModelKeyStrict(modelKey)) {
      issues.push({
        code: 'CAPABILITY_SELECTION_INVALID',
        field: `capabilitySelections.${modelKey}`,
        message: 'model key must be provider::modelId',
      })
      continue
    }

    const context = resolveModelContext(modelKey)
    if (!context) {
      issues.push({
        code: 'CAPABILITY_MODEL_UNSUPPORTED',
        field: `capabilitySelections.${modelKey}`,
        message: `model ${modelKey} is not supported by built-in capability catalog`,
      })
      continue
    }

    const normalizedSelection = normalizeSelectionRecord(
      rawSelection,
      `capabilitySelections.${modelKey}`,
    )
    issues.push(...normalizedSelection.issues)
    if (!normalizedSelection.value) continue

    issues.push(...validateCapabilitySelectionForModel({
      modelKey,
      modelType: context.modelType,
      capabilities: context.capabilities,
      selection: normalizedSelection.value,
      requireAllFields: false,
    }))
  }

  return issues
}

function mergeSelectionRecords(...records: Array<Record<string, CapabilityValue> | undefined>): Record<string, CapabilityValue> {
  const merged: Record<string, CapabilityValue> = {}
  for (const record of records) {
    if (!record) continue
    for (const [field, value] of Object.entries(record)) {
      merged[field] = value
    }
  }
  return merged
}

function pickSelectionForModel(
  selections: CapabilitySelections | undefined,
  modelKey: string,
): Record<string, CapabilityValue> | undefined {
  if (!selections) return undefined
  const selected = selections[modelKey]
  if (!selected || !isRecord(selected)) return undefined

  const normalized: Record<string, CapabilityValue> = {}
  for (const [field, rawValue] of Object.entries(selected)) {
    if (field === 'aspectRatio') continue
    if (!isCapabilityValue(rawValue)) continue
    normalized[field] = rawValue
  }
  return normalized
}

export function resolveGenerationOptionsForModel(input: {
  modelType: UnifiedModelType
  modelKey: string
  capabilities?: ModelCapabilities
  capabilityDefaults?: CapabilitySelections
  capabilityOverrides?: CapabilitySelections
  runtimeSelections?: Record<string, CapabilityValue>
  requireAllFields?: boolean
}): { options: Record<string, CapabilityValue>; issues: CapabilitySelectionValidationIssue[] } {
  const defaults = pickSelectionForModel(input.capabilityDefaults, input.modelKey)
  const overrides = pickSelectionForModel(input.capabilityOverrides, input.modelKey)
  const runtime = input.runtimeSelections

  const selection = normalizeCapabilitySelectionForModel({
    modelKey: input.modelKey,
    modelType: input.modelType,
    capabilities: input.capabilities,
    selection: mergeSelectionRecords(defaults, overrides, runtime),
  })

  // Custom model not in built-in catalog: skip validation, pass through selections directly
  if (input.capabilities === undefined) {
    return { options: { ...selection }, issues: [] }
  }

  // 对有能力选项的模型做一次预检，捕获「必填字段缺失」场景
  const precheckIssues = validateCapabilitySelectionForModel({
    modelKey: input.modelKey,
    modelType: input.modelType,
    capabilities: input.capabilities,
    selection,
    requireAllFields: input.requireAllFields ?? true,
  })

  let normalizedSelection = { ...selection }
  const autofillIssues: CapabilitySelectionValidationIssue[] = []

  // Image models often require every declared option field. If project/user config
  // omits a required field, auto-fill the first catalog option so runtime payloads
  // remain valid while still allowing explicit overrides from the UI.
  if (input.modelType === 'image') {
    const optionFields = getCapabilityOptionFields(input.modelType, input.capabilities)
    for (const [field, allowedValues] of Object.entries(optionFields)) {
      if (!Array.isArray(allowedValues) || allowedValues.length === 0) continue
      if (Object.prototype.hasOwnProperty.call(normalizedSelection, field)) continue

      const missingIssue = precheckIssues.find(
        (issue) =>
          issue.code === 'CAPABILITY_REQUIRED'
          && issue.field === `capabilities.${input.modelKey}.${field}`,
      )

      if (missingIssue) {
        normalizedSelection = {
          ...normalizedSelection,
          [field]: allowedValues[0],
        }
      }
    }
  }

  // 使用补全后的 selection 再做一次严格校验，确保不会产生非法值
  const issues = validateCapabilitySelectionForModel({
    modelKey: input.modelKey,
    modelType: input.modelType,
    capabilities: input.capabilities,
    selection: normalizedSelection,
    requireAllFields: input.requireAllFields ?? true,
  })

  if (issues.length > 0) {
    return { options: {}, issues: autofillIssues.length > 0 ? [...autofillIssues, ...issues] : issues }
  }

  const optionFields = getCapabilityOptionFields(input.modelType, input.capabilities)
  const options: Record<string, CapabilityValue> = {}
  for (const field of Object.keys(optionFields)) {
    const value = normalizedSelection[field]
    if (value !== undefined) {
      options[field] = value
    }
  }

  return { options, issues: [] }
}

export function resolveBuiltinModelContext(modelType: UnifiedModelType, modelKey: string): CapabilityModelContext | null {
  const parsed = parseModelKeyStrict(modelKey)
  if (!parsed) return null
  const entry = findBuiltinCapabilityCatalogEntry(modelType, parsed.provider, parsed.modelId)
  if (!entry) return null
  return {
    modelType: entry.modelType,
    capabilities: entry.capabilities,
  }
}

export function resolveBuiltinCapabilitiesByModelKey(
  modelType: UnifiedModelType,
  modelKey: string,
): ModelCapabilities | undefined {
  const parsed = parseModelKeyStrict(modelKey)
  if (!parsed) return undefined
  return findBuiltinCapabilities(modelType, parsed.provider, parsed.modelId)
}
