import type { UnifiedModelType } from '@/lib/model-config-contract'

export interface Flow2ApiPresetModel {
  type: UnifiedModelType
  modelId: string
  name: string
}

/**
 * Preset models injected for every `flow2api` provider instance.
 * These become disabled selectable entries in the API Config panel until the user enables them.
 */
export const FLOW2API_PRESET_MODELS: Flow2ApiPresetModel[] = [
  // ── Image ──────────────────────────────────────────────────────────────────
  { type: 'image', modelId: 'gemini-3.1-flash-image', name: 'Nano Banana 2' },
  { type: 'image', modelId: 'gemini-3.0-pro-image',   name: 'Nano Banana Pro' },
  { type: 'image', modelId: 'imagen-4.0-generate-preview', name: 'Imagen 4' },

  // ── Video ──────────────────────────────────────────────────────────────────
  { type: 'video', modelId: 'veo-3.1-fast', name: 'Veo 3.1 Fast' },
  { type: 'video', modelId: 'veo-3.1',      name: 'Veo 3.1' },
]
