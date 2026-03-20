import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai'
import { getProviderConfig } from '@/lib/api-config'
import { getInternalBaseUrl } from '@/lib/env'
import { getImageBase64Cached } from '@/lib/image-cache'
import { BaseImageGenerator, type GenerateResult, type ImageGenerateParams } from '../base'
import { setProxy } from '../../../../lib/prompts/proxy'
import { resolveFlow2ApiImageRuntimeModelId } from '@/lib/flow2api-model-aliases'

type GeminiCompatibleContentPart = { inlineData: { mimeType: string; data: string } } | { text: string }

type GeminiCompatibleOptions = {
  aspectRatio?: string
  resolution?: string
  provider?: string
  modelId?: string
  modelKey?: string
}

function toAbsoluteUrlIfNeeded(value: string): string {
  if (!value.startsWith('/')) return value
  const baseUrl = getInternalBaseUrl()
  return `${baseUrl}${value}`
}

function parseDataUrl(value: string): { mimeType: string; base64: string } | null {
  const marker = ';base64,'
  const markerIndex = value.indexOf(marker)
  if (!value.startsWith('data:') || markerIndex === -1) return null
  const mimeType = value.slice(5, markerIndex)
  const base64 = value.slice(markerIndex + marker.length)
  if (!mimeType || !base64) return null
  return { mimeType, base64 }
}

async function toInlineData(imageSource: string): Promise<{ mimeType: string; data: string } | null> {
  const parsedDataUrl = parseDataUrl(imageSource)
  if (parsedDataUrl) {
    return { mimeType: parsedDataUrl.mimeType, data: parsedDataUrl.base64 }
  }

  if (imageSource.startsWith('http://') || imageSource.startsWith('https://') || imageSource.startsWith('/')) {
    const cachedDataUrl = await getImageBase64Cached(toAbsoluteUrlIfNeeded(imageSource))
    const parsedCachedDataUrl = parseDataUrl(cachedDataUrl)
    if (!parsedCachedDataUrl) return null
    return { mimeType: parsedCachedDataUrl.mimeType, data: parsedCachedDataUrl.base64 }
  }

  return { mimeType: 'image/png', data: imageSource }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    return null
  }
  return normalized
}

function extractGenerateContentImageResult(response: unknown):
  | { imageBase64: string; imageUrl: string }
  | { imageUrl: string }
  | null {
  const responseRecord = asRecord(response)
  const candidates = Array.isArray(responseRecord?.candidates) ? responseRecord.candidates : []

  for (const candidate of candidates) {
    const content = asRecord(asRecord(candidate)?.content)
    const parts = Array.isArray(content?.parts) ? content.parts : []

    for (const part of parts) {
      const partRecord = asRecord(part)
      const inlineData = asRecord(partRecord?.inlineData)
      const imageBase64 = typeof inlineData?.data === 'string' ? inlineData.data : ''
      if (imageBase64) {
        const mimeType = typeof inlineData?.mimeType === 'string' ? inlineData.mimeType : 'image/png'
        return {
          imageBase64,
          imageUrl: `data:${mimeType};base64,${imageBase64}`,
        }
      }

      const fileData = asRecord(partRecord?.fileData)
      const fileUri = readHttpUrl(fileData?.fileUri)
      const mimeType = typeof fileData?.mimeType === 'string' ? fileData.mimeType : ''
      if (fileUri && (!mimeType || mimeType.startsWith('image/'))) {
        return { imageUrl: fileUri }
      }

      const textUrl = readHttpUrl(partRecord?.text)
      if (textUrl) {
        return { imageUrl: textUrl }
      }
    }
  }

  return null
}

function assertAllowedOptions(options: Record<string, unknown>) {
  const allowedKeys = new Set([
    'provider',
    'modelId',
    'modelKey',
    'aspectRatio',
    'resolution',
  ])
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!allowedKeys.has(key)) {
      throw new Error(`GEMINI_COMPATIBLE_IMAGE_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

export class GeminiCompatibleImageGenerator extends BaseImageGenerator {
  private readonly modelId?: string
  private readonly providerId?: string

  constructor(modelId?: string, providerId?: string) {
    super()
    this.modelId = modelId
    this.providerId = providerId
  }

  protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
    const { userId, prompt, referenceImages = [], options = {} } = params
    assertAllowedOptions(options)

    const providerId = this.providerId || 'gemini-compatible'
    const providerConfig = await getProviderConfig(userId, providerId)
    if (!providerConfig.baseUrl) {
      throw new Error(`PROVIDER_BASE_URL_MISSING: ${providerId}`)
    }
    await setProxy()

    const ai = new GoogleGenAI({
      apiKey: providerConfig.apiKey,
      httpOptions: { baseUrl: providerConfig.baseUrl },
    })
    const normalizedOptions = options as GeminiCompatibleOptions
    const resolvedModelId = resolveFlow2ApiImageRuntimeModelId(
      this.modelId || normalizedOptions.modelId || 'gemini-2.5-flash-image',
    )
    const parts: GeminiCompatibleContentPart[] = []

    for (const referenceImage of referenceImages.slice(0, 14)) {
      const inlineData = await toInlineData(referenceImage)
      if (!inlineData) {
        throw new Error('GEMINI_COMPATIBLE_REFERENCE_INVALID: failed to parse reference image')
      }
      parts.push({ inlineData })
    }
    parts.push({ text: prompt })

    const response = await ai.models.generateContent({
      model: resolvedModelId,
      contents: [{ parts }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
        ...(normalizedOptions.aspectRatio || normalizedOptions.resolution
          ? {
            imageConfig: {
              ...(normalizedOptions.aspectRatio ? { aspectRatio: normalizedOptions.aspectRatio } : {}),
              ...(normalizedOptions.resolution ? { imageSize: normalizedOptions.resolution } : {}),
            },
          }
          : {}),
      },
    })

    const parsedResult = extractGenerateContentImageResult(response)
    if (parsedResult) {
      return {
        success: true,
        ...parsedResult,
      }
    }

    const candidate = response.candidates?.[0]

    const finishReason = candidate?.finishReason
    if (finishReason === 'IMAGE_SAFETY' || finishReason === 'SAFETY') {
      throw new Error('内容因安全策略被过滤')
    }

    throw new Error('GEMINI_COMPATIBLE_IMAGE_EMPTY_RESPONSE: no image data returned')
  }
}
