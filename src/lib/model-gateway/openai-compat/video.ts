import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import type { GenerateResult } from '@/lib/generators/base'
import type { OpenAICompatVideoRequest } from '../types'
import { createOpenAICompatClient, parseDataUrl, readStringOption, resolveOpenAICompatClientConfig } from './common'
import { toFile } from 'openai'
import { collectTextValue, extractStreamDeltaParts } from '@/lib/llm/utils'

type OpenAIVideoSize = '720x1280' | '1280x720' | '1024x1792' | '1792x1024'
type OpenAIVideoSeconds = '4' | '8' | '12'
type OpenAIVideoAspectRatio =
  | '16:9'
  | '9:16'
  | '4:3'
  | '3:4'
  | '3:2'
  | '2:3'
  | '21:9'
  | '9:21'
  | '1:1'
  | 'auto'

const OPENAI_COMPAT_VIDEO_OPTION_KEYS = new Set([
  'provider',
  'modelId',
  'modelKey',
  'duration',
  'resolution',
  'aspectRatio',
  'aspect_ratio',
  'size',
  'generateAudio',
  'generationMode',
])

function assertAllowedOptions(options: Record<string, unknown>) {
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!OPENAI_COMPAT_VIDEO_OPTION_KEYS.has(key)) {
      throw new Error(`OPENAI_COMPAT_VIDEO_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

function normalizeDuration(value: unknown): OpenAIVideoSeconds | undefined {
  if (value === 4 || value === '4') return '4'
  if (value === 8 || value === '8') return '8'
  if (value === 12 || value === '12') return '12'
  if (value === undefined) return undefined
  throw new Error(`OPENAI_COMPAT_VIDEO_DURATION_UNSUPPORTED: ${String(value)}`)
}

function normalizeAspectRatio(value: unknown): OpenAIVideoAspectRatio | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new Error(`OPENAI_COMPAT_VIDEO_ASPECT_RATIO_UNSUPPORTED: ${String(value)}`)
  }
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (
    trimmed === '16:9'
    || trimmed === '9:16'
    || trimmed === '4:3'
    || trimmed === '3:4'
    || trimmed === '3:2'
    || trimmed === '2:3'
    || trimmed === '21:9'
    || trimmed === '9:21'
    || trimmed === '1:1'
    || trimmed === 'auto'
  ) {
    return trimmed
  }
  throw new Error(`OPENAI_COMPAT_VIDEO_ASPECT_RATIO_UNSUPPORTED: ${trimmed}`)
}

function resolveAspectRatio(options: Record<string, unknown>): OpenAIVideoAspectRatio | undefined {
  const aspectRatio = normalizeAspectRatio(options.aspectRatio)
  const aspectRatioAlt = normalizeAspectRatio(options.aspect_ratio)
  if (aspectRatio && aspectRatioAlt && aspectRatio !== aspectRatioAlt) {
    throw new Error('OPENAI_COMPAT_VIDEO_ASPECT_RATIO_CONFLICT: aspectRatio and aspect_ratio must match')
  }
  return aspectRatio || aspectRatioAlt
}

function normalizeModel(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'sora-2'
  if (typeof value !== 'string') {
    throw new Error(`OPENAI_COMPAT_VIDEO_MODEL_INVALID: ${String(value)}`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('OPENAI_COMPAT_VIDEO_MODEL_INVALID: empty model id')
  }
  return trimmed
}

function resolveSizeOrientation(aspectRatio: OpenAIVideoAspectRatio | undefined): 'portrait' | 'landscape' {
  if (
    aspectRatio === '9:16'
    || aspectRatio === '3:4'
    || aspectRatio === '2:3'
    || aspectRatio === '9:21'
  ) {
    return 'portrait'
  }
  return 'landscape'
}

function normalizeSize(value: unknown, aspectRatio: OpenAIVideoAspectRatio | undefined): OpenAIVideoSize | undefined {
  if (value === '720x1280' || value === '1280x720' || value === '1024x1792' || value === '1792x1024') {
    return value
  }

  const orientation = resolveSizeOrientation(aspectRatio)
  if (value === '720p') {
    return orientation === 'portrait' ? '720x1280' : '1280x720'
  }
  if (value === '1080p') {
    return orientation === 'portrait' ? '1024x1792' : '1792x1024'
  }
  if (value === undefined) return undefined
  throw new Error(`OPENAI_COMPAT_VIDEO_SIZE_UNSUPPORTED: ${String(value)}`)
}

function resolveFinalSize(options: Record<string, unknown>): OpenAIVideoSize | undefined {
  const aspectRatio = resolveAspectRatio(options)
  const normalizedSize = options.size === undefined ? undefined : normalizeSize(options.size, aspectRatio)
  const normalizedResolution = options.resolution === undefined ? undefined : normalizeSize(options.resolution, aspectRatio)
  if (normalizedSize && normalizedResolution && normalizedSize !== normalizedResolution) {
    throw new Error('OPENAI_COMPAT_VIDEO_SIZE_CONFLICT: size and resolution must match')
  }
  return normalizedSize || normalizedResolution
}

function encodeProviderId(providerId: string): string {
  return Buffer.from(providerId, 'utf8').toString('base64url')
}

function shouldPreferChatCompletionsVideo(modelId: string): boolean {
  return /^veo_/i.test(modelId)
}

export function extractVideoUrlFromText(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const videoTagMatch = trimmed.match(/<video[^>]+src=['"]([^'"]+)['"]/i)
  if (videoTagMatch?.[1]) {
    return videoTagMatch[1].trim()
  }

  const mediaUrlMatch = trimmed.match(/https?:\/\/[^\s'"<>]+\.(mp4|webm|mov)(?:\?[^\s'"<>]*)?/i)
  if (mediaUrlMatch?.[0]) {
    return mediaUrlMatch[0].trim()
  }

  const genericUrlMatch = trimmed.match(/https?:\/\/[^\s'"<>]+/i)
  if (genericUrlMatch?.[0]) {
    return genericUrlMatch[0].trim()
  }

  return null
}

async function toChatCompletionImageUrlPart(imageUrl: string): Promise<{ type: 'image_url'; image_url: { url: string } }> {
  const dataUrl = imageUrl.startsWith('data:') ? imageUrl : await normalizeToBase64ForGeneration(imageUrl)
  return {
    type: 'image_url',
    image_url: {
      url: dataUrl,
    },
  }
}

async function generateVideoViaChatCompletionsStream(input: {
  config: Awaited<ReturnType<typeof resolveOpenAICompatClientConfig>>
  modelId: string
  prompt: string
  imageUrl: string
  lastFrameImageUrl?: string
}): Promise<GenerateResult> {
  const client = createOpenAICompatClient(input.config)
  const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
    { type: 'text', text: input.prompt },
    await toChatCompletionImageUrlPart(input.imageUrl),
  ]

  if (input.lastFrameImageUrl) {
    content.push(await toChatCompletionImageUrlPart(input.lastFrameImageUrl))
  }

  const stream = await client.chat.completions.create({
    model: input.modelId,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
    stream: true,
  } as never)
  const streamIterable = stream as unknown as AsyncIterable<unknown>
  const streamWithFinalizer = stream as unknown as AsyncIterable<unknown> & {
    finalChatCompletion?: () => Promise<{ choices?: Array<{ message?: { content?: unknown } }> }>
  }

  let streamedText = ''
  for await (const part of streamIterable) {
    const { textDelta } = extractStreamDeltaParts(part)
    if (textDelta) {
      streamedText += textDelta
    }
  }

  let finalContent = ''
  const finalChatCompletion = streamWithFinalizer.finalChatCompletion
  if (typeof finalChatCompletion === 'function') {
    try {
      const completion = await finalChatCompletion.call(streamWithFinalizer)
      finalContent = collectTextValue(completion.choices?.[0]?.message?.content)
    } catch {
      finalContent = ''
    }
  }

  const videoUrl = extractVideoUrlFromText(`${streamedText}\n${finalContent}`)
  if (!videoUrl) {
    throw new Error('OPENAI_COMPAT_VIDEO_CHAT_COMPLETIONS_EMPTY_RESPONSE')
  }

  return {
    success: true,
    videoUrl,
  }
}

async function toUploadFileFromImageUrl(imageUrl: string): Promise<File> {
  const base64DataUrl = imageUrl.startsWith('data:') ? imageUrl : await normalizeToBase64ForGeneration(imageUrl)
  const parsed = parseDataUrl(base64DataUrl)
  if (!parsed) {
    throw new Error('OPENAI_COMPAT_VIDEO_INPUT_REFERENCE_INVALID')
  }
  const bytes = Buffer.from(parsed.base64, 'base64')
  return await toFile(bytes, 'input-reference.png', { type: parsed.mimeType })
}

export async function generateVideoViaOpenAICompat(request: OpenAICompatVideoRequest): Promise<GenerateResult> {
  const {
    userId,
    providerId,
    modelId,
    imageUrl,
    prompt,
    options = {},
  } = request

  assertAllowedOptions(options)
  const config = await resolveOpenAICompatClientConfig(userId, providerId)
  const client = createOpenAICompatClient(config)

  const selectedModelId = normalizeModel(modelId || options.modelId)
  const seconds = normalizeDuration(options.duration)
  const size = resolveFinalSize(options)
  const trimmedPrompt = prompt.trim()
  if (!trimmedPrompt) {
    throw new Error('OPENAI_COMPAT_VIDEO_PROMPT_REQUIRED')
  }

  const lastFrameImageUrl = readStringOption(options.lastFrameImageUrl, 'lastFrameImageUrl')

  if (shouldPreferChatCompletionsVideo(selectedModelId)) {
    return await generateVideoViaChatCompletionsStream({
      config,
      modelId: selectedModelId,
      prompt: trimmedPrompt,
      imageUrl,
      ...(lastFrameImageUrl ? { lastFrameImageUrl } : {}),
    })
  }

  const inputReference = await toUploadFileFromImageUrl(imageUrl)
  const response = await client.videos.create({
    prompt: trimmedPrompt,
    model: selectedModelId,
    ...(seconds ? { seconds } : {}),
    ...(size ? { size } : {}),
    input_reference: inputReference,
  } as Parameters<typeof client.videos.create>[0])

  if (!response.id || typeof response.id !== 'string') {
    throw new Error('OPENAI_COMPAT_VIDEO_CREATE_INVALID_RESPONSE: missing video id')
  }

  const providerToken = encodeProviderId(config.providerId)
  return {
    success: true,
    async: true,
    requestId: response.id,
    externalId: `OPENAI:VIDEO:${providerToken}:${response.id}`,
  }
}
