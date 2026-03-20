/**
 * Google Veo 视频生成器
 */

import { GoogleGenAI } from '@google/genai'
import { BaseVideoGenerator, VideoGenerateParams, GenerateResult } from '../base'
import { getProviderConfig, getProviderKey } from '@/lib/api-config'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { resolveFlow2ApiVideoRuntimeModelId } from '@/lib/flow2api-model-aliases'

interface GoogleVeoOptions {
    modelId?: string
    aspectRatio?: string
    resolution?: string
    duration?: number
    lastFrameImageUrl?: string
}

function dataUrlToInlineData(dataUrl: string): { mimeType: string; imageBytes: string } | null {
    const base64Start = dataUrl.indexOf(';base64,')
    if (base64Start === -1) return null
    const mimeType = dataUrl.substring(5, base64Start)
    const imageBytes = dataUrl.substring(base64Start + 8)
    return { mimeType, imageBytes }
}

function dataUrlToPart(dataUrl: string): { inlineData: { mimeType: string; data: string } } | null {
    const base64Start = dataUrl.indexOf(';base64,')
    if (base64Start === -1) return null
    const mimeType = dataUrl.substring(5, base64Start)
    const data = dataUrl.substring(base64Start + 8)
    return { inlineData: { mimeType, data } }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function extractOperationName(response: unknown): string | null {
    const obj = asRecord(response)
    if (!obj) return null
    if (typeof obj.name === 'string') return obj.name
    const operation = asRecord(obj.operation)
    if (operation && typeof operation.name === 'string') return operation.name
    if (typeof obj.operationName === 'string') return obj.operationName
    if (typeof obj.id === 'string') return obj.id
    return null
}

function encodeProviderToken(providerId: string): string {
    return Buffer.from(providerId, 'utf8').toString('base64url')
}

function extractGenerateContentVideoUrl(response: unknown): string | null {
    const obj = asRecord(response)
    const candidates = Array.isArray(obj?.candidates) ? obj.candidates : []
    for (const candidateRaw of candidates) {
        const candidate = asRecord(candidateRaw)
        const content = asRecord(candidate?.content)
        const parts = Array.isArray(content?.parts) ? content.parts : []
        for (const partRaw of parts) {
            const part = asRecord(partRaw)
            const fileData = asRecord(part?.fileData)
            if (typeof fileData?.fileUri === 'string' && fileData.fileUri.trim()) {
                return fileData.fileUri.trim()
            }
            if (typeof part?.text === 'string') {
                const match = part.text.match(/<video[^>]+src=['\"]([^'\"]+)['\"]/i)
                if (match?.[1]) {
                    return match[1]
                }
            }
        }
    }
    return null
}

export class GoogleVeoVideoGenerator extends BaseVideoGenerator {
    private providerId: string

    constructor(providerId?: string) {
        super()
        this.providerId = providerId || 'google'
    }

    protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
        const { userId, imageUrl, prompt = '', options = {} } = params

        const {
            modelId = 'veo-3.1-generate-preview',
            aspectRatio,
            resolution,
            duration,
            lastFrameImageUrl,
        } = options as GoogleVeoOptions

        const providerConfig = await getProviderConfig(userId, this.providerId, { modelId })
        const providerKey = getProviderKey(this.providerId).toLowerCase()
        const ai = new GoogleGenAI({
            apiKey: providerConfig.apiKey,
            ...(providerConfig.baseUrl ? { httpOptions: { baseUrl: providerConfig.baseUrl } } : {}),
        })

        const allowedOptionKeys = new Set([
            'provider',
            'modelId',
            'modelKey',
            'aspectRatio',
            'resolution',
            'duration',
            'lastFrameImageUrl',
        ])
        for (const [key, value] of Object.entries(options)) {
            if (value === undefined) continue
            if (!allowedOptionKeys.has(key)) {
                throw new Error(`GOOGLE_VIDEO_OPTION_UNSUPPORTED: ${key}`)
            }
        }

        if (providerKey === 'gemini-compatible') {
            const contentsParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = []
            if (prompt.trim().length > 0) {
                contentsParts.push({ text: prompt })
            }
            if (imageUrl) {
                const dataUrl = imageUrl.startsWith('data:') ? imageUrl : await normalizeToBase64ForGeneration(imageUrl)
                const part = dataUrlToPart(dataUrl)
                if (part) {
                    contentsParts.push(part)
                }
            }
            if (lastFrameImageUrl) {
                const dataUrl = lastFrameImageUrl.startsWith('data:')
                    ? lastFrameImageUrl
                    : await normalizeToBase64ForGeneration(lastFrameImageUrl)
                const part = dataUrlToPart(dataUrl)
                if (!part) {
                    throw new Error('FLOW2API_VIDEO_LAST_FRAME_INVALID')
                }
                contentsParts.push(part)
            }
            if (contentsParts.length === 0) {
                throw new Error('FLOW2API_VIDEO_PROMPT_OR_IMAGE_REQUIRED')
            }

            const response = await ai.models.generateContent({
                model: resolveFlow2ApiVideoRuntimeModelId(modelId),
                contents: [{ parts: contentsParts }],
                config: {
                    responseModalities: ['VIDEO'],
                    ...(aspectRatio ? { aspectRatio } : {}),
                    ...(resolution ? { resolution } : {}),
                    ...(typeof duration === 'number' ? { durationSeconds: duration } : {}),
                },
            })
            const videoUrl = extractGenerateContentVideoUrl(response)
            if (!videoUrl) {
                throw new Error('FLOW2API_VIDEO_EMPTY_RESPONSE: no video url returned')
            }
            return {
                success: true,
                videoUrl,
            }
        }

        const request: Record<string, unknown> = {
            model: modelId,
        }
        if (prompt.trim().length > 0) {
            request.prompt = prompt
        }
        const config: Record<string, unknown> = {}
        if (aspectRatio) config.aspectRatio = aspectRatio
        if (resolution) config.resolution = resolution
        if (typeof duration === 'number') config.durationSeconds = duration

        let hasImageInput = false
        // 添加首帧图片（图生视频）
        if (imageUrl) {
            const dataUrl = imageUrl.startsWith('data:') ? imageUrl : await normalizeToBase64ForGeneration(imageUrl)
            const inlineData = dataUrlToInlineData(dataUrl)
            if (inlineData) {
                request.image = inlineData
                hasImageInput = true
            }
        }

        if (lastFrameImageUrl) {
            // 官方要求：lastFrame 仅支持 image-to-video，必须与 image 同时使用
            if (!hasImageInput) {
                throw new Error('Veo lastFrame requires image input')
            }
            const dataUrl = lastFrameImageUrl.startsWith('data:')
                ? lastFrameImageUrl
                : await normalizeToBase64ForGeneration(lastFrameImageUrl)
            const inlineData = dataUrlToInlineData(dataUrl)
            if (!inlineData) {
                throw new Error('Veo lastFrame image is invalid')
            }
            config.lastFrame = inlineData
        }

        if (Object.keys(config).length > 0) {
            request.config = config
        }

        const response = await ai.models.generateVideos(
            request as unknown as Parameters<typeof ai.models.generateVideos>[0]
        )
        const operationName = extractOperationName(response)

        if (!operationName) {
            throw new Error('Veo 未返回 operation name')
        }

        return {
            success: true,
            async: true,
            requestId: operationName,
            externalId: this.providerId && this.providerId !== 'google'
                ? `GOOGLE:VIDEO:${encodeProviderToken(this.providerId)}:${operationName}`
                : `GOOGLE:VIDEO:${operationName}`
        }
    }
}
