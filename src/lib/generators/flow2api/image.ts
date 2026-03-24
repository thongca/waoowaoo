import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { BaseImageGenerator, type GenerateResult, type ImageGenerateParams } from '../base'
import { createOpenAICompatClient, resolveOpenAICompatClientConfig } from '@/lib/model-gateway/openai-compat/common'
import { extractStreamDeltaParts, collectTextValue } from '@/lib/llm/utils'
import { resolveFlow2ApiImageModelId, isFlow2ApiImageCanonicalId } from '@/lib/flow2api-model-resolver'

function inferAspectRatio(options: Record<string, unknown>): string {
  if (typeof options.aspectRatio === 'string' && options.aspectRatio.includes(':')) {
    return options.aspectRatio.trim()
  }
  if (typeof options.resolution === 'string' && options.resolution.trim().includes(':')) {
    return options.resolution.trim()
  }
  return '1:1'
}

function inferImageSize(options: Record<string, unknown>): string {
  if (typeof options.imageSize === 'string' && options.imageSize.trim()) {
    return options.imageSize.trim()
  }
  return '1K'
}

async function toImageUrlPart(
  imageSource: string,
): Promise<{ type: 'image_url'; image_url: { url: string } }> {
  const dataUrl = imageSource.startsWith('data:')
    ? imageSource
    : await normalizeToBase64ForGeneration(imageSource)
  return { type: 'image_url', image_url: { url: dataUrl } }
}

/**
 * Extracts an image URL or data URL from flow2api's streamed chat completion response.
 * The server may return the image as:
 *   1. A data URL inline: data:image/webp;base64,...
 *   2. A markdown image: ![](https://...)
 *   3. A plain HTTPS URL pointing to an image file
 */
export function extractImageFromText(value: string): { imageUrl?: string; imageBase64?: string } | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  // data URL
  const dataUrlMatch = trimmed.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/)
  if (dataUrlMatch) {
    const dataUrl = dataUrlMatch[0]
    return { imageUrl: dataUrl, imageBase64: dataUrl.split(',')[1] }
  }

  // Markdown image: ![...](url)
  const mdMatch = trimmed.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/)
  if (mdMatch?.[1]) return { imageUrl: mdMatch[1].trim() }

  // Direct image file URL
  const fileUrlMatch = trimmed.match(
    /https?:\/\/[^\s'"<>]+\.(?:png|jpg|jpeg|webp|gif)(?:\?[^\s'"<>]*)?/i,
  )
  if (fileUrlMatch?.[0]) return { imageUrl: fileUrlMatch[0].trim() }

  // Any HTTPS URL (broad fallback)
  const genericUrlMatch = trimmed.match(/https?:\/\/[^\s'"<>]+/i)
  if (genericUrlMatch?.[0]) return { imageUrl: genericUrlMatch[0].trim() }

  return null
}

/**
 * Generates images via the flow2api `/v1/chat/completions` streaming endpoint.
 *
 * Resolves the actual model ID from the canonical model ID + capability selections
 * (aspect ratio and size tier), then sends a chat completions request with optional
 * reference images and accumulates the streamed response to extract the image.
 */
export class Flow2ApiImageGenerator extends BaseImageGenerator {
  private readonly providerId: string

  constructor(providerId: string) {
    super()
    this.providerId = providerId
  }

  protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
    const { userId, prompt, referenceImages = [], options = {} } = params
    const opts = options as Record<string, unknown>

    // Resolve canonical → actual model ID
    const canonicalModelId = typeof opts.modelId === 'string' ? opts.modelId.trim() : ''
    const actualModelId = isFlow2ApiImageCanonicalId(canonicalModelId)
      ? resolveFlow2ApiImageModelId(
          canonicalModelId,
          inferAspectRatio(opts),
          inferImageSize(opts),
        )
      : canonicalModelId || 'gemini-3.1-flash-image-landscape'

    const config = await resolveOpenAICompatClientConfig(userId, this.providerId)
    const client = createOpenAICompatClient(config)

    // Build message content
    type ContentPart =
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }

    const trimmedPrompt = prompt.trim()
    const hasImages = referenceImages.length > 0

    let messageContent: string | ContentPart[]
    if (hasImages) {
      const parts: ContentPart[] = [{ type: 'text', text: trimmedPrompt }]
      for (const ref of referenceImages.slice(0, 5)) {
        parts.push(await toImageUrlPart(ref))
      }
      messageContent = parts
    } else {
      messageContent = trimmedPrompt
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

    const combined = `${streamedText}\n${finalContent}`
    const result = extractImageFromText(combined)
    if (!result) {
      throw new Error('FLOW2API_IMAGE_EMPTY_RESPONSE')
    }

    return {
      success: true,
      ...(result.imageUrl !== undefined ? { imageUrl: result.imageUrl } : {}),
      ...(result.imageBase64 !== undefined ? { imageBase64: result.imageBase64 } : {}),
    }
  }
}
