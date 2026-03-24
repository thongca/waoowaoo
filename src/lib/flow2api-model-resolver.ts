/**
 * Resolves canonical model IDs + capability selections into the exact
 * flow2api API model strings.
 *
 * flow2api exposes discrete model IDs that encode aspect-ratio, size-tier,
 * generation-mode and orientation as suffixes. Rather than exposing every
 * variant to users as separate models, we store a single canonical ID and
 * resolve the actual API model at generation time based on the user's
 * capability selections.
 */

// ─── Image helpers ────────────────────────────────────────────────────────────

const ASPECT_RATIO_SUFFIX: Record<string, string> = {
  '16:9': '-landscape',
  '9:16': '-portrait',
  '1:1':  '-square',
  '4:3':  '-four-three',
  '3:4':  '-three-four',
}

function normalizeFlow2ApiImageAspectRatio(aspectRatio: string): keyof typeof ASPECT_RATIO_SUFFIX {
  const normalized = aspectRatio.trim()
  if (normalized in ASPECT_RATIO_SUFFIX) {
    return normalized as keyof typeof ASPECT_RATIO_SUFFIX
  }

  // flow2api image models currently support 16:9, 9:16, 1:1, 4:3, 3:4.
  // Map unsupported nearby ratios to the closest supported family.
  if (normalized === '3:2') return '16:9'
  if (normalized === '2:3') return '9:16'

  return '16:9'
}

const IMAGE_SIZE_SUFFIX: Record<string, string> = {
  '1K': '',
  '2K': '-2k',
  '4K': '-4k',
}

/**
 * Resolve a flow2api image model ID.
 *
 * Examples:
 *   ('gemini-3.1-flash-image', '16:9', '1K')  → 'gemini-3.1-flash-image-landscape'
 *   ('gemini-3.1-flash-image', '4:3',  '2K')  → 'gemini-3.1-flash-image-four-three-2k'
 *   ('gemini-3.0-pro-image',   '9:16', '4K')  → 'gemini-3.0-pro-image-portrait-4k'
 *   ('imagen-4.0-generate-preview', '9:16')   → 'imagen-4.0-generate-preview-portrait'
 */
export function resolveFlow2ApiImageModelId(
  canonicalId: string,
  aspectRatio: string,
  imageSize?: string,
): string {
  const normalizedAspectRatio = normalizeFlow2ApiImageAspectRatio(aspectRatio)
  const aspectSuffix = ASPECT_RATIO_SUFFIX[normalizedAspectRatio]
  const sizeSuffix = imageSize ? (IMAGE_SIZE_SUFFIX[imageSize] ?? `-${imageSize.toLowerCase()}`) : ''
  return `${canonicalId}${aspectSuffix}${sizeSuffix}`
}

// ─── Video helpers ────────────────────────────────────────────────────────────

type VideoGenerationMode = 't2v' | 'i2v' | 'r2v'
type VideoAspectRatio = '16:9' | '9:16'

/**
 * Resolve the flow2api video model ID for Veo 3.1 Fast (canonical: 'veo-3.1-fast').
 *
 * mode   aspect  result
 * t2v    16:9  → veo_3_1_t2v_fast_landscape
 * t2v    9:16  → veo_3_1_t2v_fast_portrait
 * i2v    16:9  → veo_3_1_i2v_s_fast_fl
 * i2v    9:16  → veo_3_1_i2v_s_fast_portrait_fl
 * r2v    16:9  → veo_3_1_r2v_fast
 * r2v    9:16  → veo_3_1_r2v_fast_portrait
 */
function resolveVeo31FastModelId(mode: VideoGenerationMode, aspectRatio: VideoAspectRatio): string {
  const isPortrait = aspectRatio === '9:16'
  switch (mode) {
    case 't2v':
      return isPortrait ? 'veo_3_1_t2v_fast_portrait' : 'veo_3_1_t2v_fast_landscape'
    case 'i2v':
      return isPortrait ? 'veo_3_1_i2v_s_fast_portrait_fl' : 'veo_3_1_i2v_s_fast_fl'
    case 'r2v':
      return isPortrait ? 'veo_3_1_r2v_fast_portrait' : 'veo_3_1_r2v_fast'
    default:
      return isPortrait ? 'veo_3_1_i2v_s_fast_portrait_fl' : 'veo_3_1_i2v_s_fast_fl'
  }
}

/**
 * Resolve the flow2api video model ID for Veo 3.1 Quality (canonical: 'veo-3.1').
 *
 * mode   aspect  result
 * t2v    16:9  → veo_3_1_t2v_landscape
 * t2v    9:16  → veo_3_1_t2v_portrait
 * i2v    16:9  → veo_3_1_i2v_s_landscape
 * i2v    9:16  → veo_3_1_i2v_s_portrait
 */
function resolveVeo31ModelId(mode: VideoGenerationMode, aspectRatio: VideoAspectRatio): string {
  const isPortrait = aspectRatio === '9:16'
  switch (mode) {
    case 't2v':
      return isPortrait ? 'veo_3_1_t2v_portrait' : 'veo_3_1_t2v_landscape'
    case 'i2v':
    default:
      return isPortrait ? 'veo_3_1_i2v_s_portrait' : 'veo_3_1_i2v_s_landscape'
  }
}

/**
 * Resolve a flow2api video model ID from a canonical model ID, generation mode,
 * and aspect ratio.
 *
 * The canonical IDs are:
 *   'veo-3.1-fast'  → Veo 3.1 Fast (modes: t2v, i2v, r2v)
 *   'veo-3.1'       → Veo 3.1 Quality (modes: t2v, i2v)
 */
export function resolveFlow2ApiVideoModelId(
  canonicalId: string,
  generationMode: string,
  aspectRatio: string,
): string {
  const mode = (generationMode as VideoGenerationMode) || 'i2v'
  const aspect: VideoAspectRatio = aspectRatio === '9:16' ? '9:16' : '16:9'

  switch (canonicalId) {
    case 'veo-3.1-fast':
      return resolveVeo31FastModelId(mode, aspect)
    case 'veo-3.1':
      return resolveVeo31ModelId(mode as 't2v' | 'i2v', aspect)
    default:
      // Fallback: canonical ID is the actual model ID (no mapping)
      return canonicalId
  }
}

/**
 * Returns true if the canonical model ID is a flow2api video model that
 * requires resolution via resolveFlow2ApiVideoModelId().
 */
export function isFlow2ApiVideoCanonicalId(modelId: string): boolean {
  return modelId === 'veo-3.1-fast' || modelId === 'veo-3.1'
}

/**
 * Returns true if the canonical model ID is a flow2api image model that
 * requires resolution via resolveFlow2ApiImageModelId().
 */
export function isFlow2ApiImageCanonicalId(modelId: string): boolean {
  return (
    modelId === 'gemini-3.1-flash-image' ||
    modelId === 'gemini-3.0-pro-image' ||
    modelId === 'imagen-4.0-generate-preview'
  )
}
