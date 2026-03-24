import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { BaseVideoGenerator, type GenerateResult, type VideoGenerateParams } from '../base'
import {
  createOpenAICompatClient,
  resolveOpenAICompatClientConfig,
} from '@/lib/model-gateway/openai-compat/common'
import { extractStreamDeltaParts, collectTextValue } from '@/lib/llm/utils'
import { extractVideoUrlFromText } from '@/lib/model-gateway/openai-compat/video'
import {
  resolveFlow2ApiVideoModelId,
  isFlow2ApiVideoCanonicalId,
} from '@/lib/flow2api-model-resolver'

function resolveGenerationMode(options: Record<string, unknown>): string {
  const raw = typeof options.generationMode === 'string' ? options.generationMode.trim() : ''
  if (raw === 't2v') return 't2v'
  if (raw === 'r2v') return 'r2v'
  if (raw === 'i2v' || raw === 'firstlastframe') return 'i2v'
  // Legacy: 'normal' mapped to t2v (Generate Video mode)
  if (raw === 'normal') return 't2v'
  // Default: t2v (worker always provides an explicit mode)
  return 't2v'
}

function resolveAspectRatioFromOptions(options: Record<string, unknown>): string {
  // resolution capability field contains the aspect ratio selection (e.g. "9:16")
  if (typeof options.resolution === 'string' && options.resolution.trim().includes(':')) {
    return options.resolution.trim()
  }
  if (typeof options.aspectRatio === 'string' && options.aspectRatio.trim().includes(':')) {
    return options.aspectRatio.trim()
  }
  return '16:9'
}

async function toImageUrlPart(imageSource: string): Promise<{
  type: 'image_url'
  image_url: { url: string }
}> {
  const dataUrl = imageSource.startsWith('data:')
    ? imageSource
    : await normalizeToBase64ForGeneration(imageSource)
  return { type: 'image_url', image_url: { url: dataUrl } }
}

/**
 * Generates video via flow2api's `/v1/chat/completions` streaming endpoint.
 *
 * Mode routing:
 *   t2v → text-only, no image input
 *   i2v → first-frame image; if lastFrameImageUrl present → first+last frame mode
 *   r2v → single reference image (multi-ref out of scope for this phase)
 *   firstlastframe → treated as i2v with lastFrameImageUrl
 *
 * Resolves the actual flow2api model ID (e.g. veo_3_1_t2v_fast_landscape) from
 * the canonical model ID (e.g. veo-3.1-fast), mode, and aspect ratio at runtime.
 */
export class Flow2ApiVideoGenerator extends BaseVideoGenerator {
  private readonly providerId: string

  constructor(providerId: string) {
    super()
    this.providerId = providerId
  }

  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const { userId, imageUrl, prompt = '', options = {} } = params
    const opts = options as Record<string, unknown>

    const canonicalModelId = typeof opts.modelId === 'string' ? opts.modelId.trim() : ''
    const mode = resolveGenerationMode(opts)
    const aspectRatio = resolveAspectRatioFromOptions(opts)

    const actualModelId = isFlow2ApiVideoCanonicalId(canonicalModelId)
      ? resolveFlow2ApiVideoModelId(canonicalModelId, mode, aspectRatio)
      : canonicalModelId || 'veo_3_1_i2v_s_fast_fl'

    const config = await resolveOpenAICompatClientConfig(userId, this.providerId)
    const client = createOpenAICompatClient(config)

    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt && mode === 't2v') {
      throw new Error('FLOW2API_VIDEO_PROMPT_REQUIRED')
    }

    type ContentPart =
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }

    let messageContent: string | ContentPart[]

    if (mode === 't2v') {
      // Text-only: no image input
      messageContent = trimmedPrompt
    } else {
      // i2v / r2v / firstlastframe: include image as first frame
      const parts: ContentPart[] = [{ type: 'text', text: trimmedPrompt }]
      parts.push(await toImageUrlPart(imageUrl))

      // Second image = last frame (first-last-frame mode)
      const lastFrameUrl =
        typeof opts.lastFrameImageUrl === 'string' ? opts.lastFrameImageUrl.trim() : ''
      if (lastFrameUrl) {
        parts.push(await toImageUrlPart(lastFrameUrl))
      }

      messageContent = parts
    }

    const stream = await client.chat.completions.create({
      model: actualModelId,
      messages: [{ role: 'user', content: messageContent as never }],
      stream: true,
    } as never)

    const streamIterable = stream as unknown as AsyncIterable<unknown>
    const streamWithFinalizer = stream as unknown as AsyncIterable<unknown> & {
      finalChatCompletion?: () => Promise<{ choices?: Array<{ message?: { content?: unknown } }> }>
    }

    let streamedText = ''
    for await (const part of streamIterable) {
      const { textDelta } = extractStreamDeltaParts(part)
      if (textDelta) streamedText += textDelta
    }

    let finalContent = ''
    if (typeof streamWithFinalizer.finalChatCompletion === 'function') {
      try {
        const completion = await streamWithFinalizer.finalChatCompletion.call(streamWithFinalizer)
        finalContent = collectTextValue(completion.choices?.[0]?.message?.content)
      } catch {
        finalContent = ''
      }
    }

    const videoUrl = extractVideoUrlFromText(`${streamedText}\n${finalContent}`)
    if (!videoUrl) {
      throw new Error('FLOW2API_VIDEO_EMPTY_RESPONSE')
    }

    return { success: true, videoUrl }
  }
}
