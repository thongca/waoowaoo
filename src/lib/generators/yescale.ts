import { logError as _ulogError, logInfo as _ulogInfo } from '@/lib/logging/core'
import {
    BaseImageGenerator,
    BaseVideoGenerator,
    BaseAudioGenerator,
    type AudioGenerateParams,
    type GenerateOptions,
    type GenerateResult,
    type ImageGenerateParams,
    type VideoGenerateParams,
} from './base'
import { getProviderConfig } from '@/lib/api-config'

const YESCALE_MEDIA_BASE_URL = 'https://api.yescale.io'

type YeScaleSubmitPayload = {
    model: string
    prompt: string
    config: Record<string, unknown>
}

type YeScaleSubmitResponse = {
    task_id?: string
    status?: string
    error?: string
    message?: string
}

type YeScaleAudioSpeechPayload = {
    model: string
    input: string
    voice: string
    response_format: 'mp3'
    speed?: number
}

type GeminiTtsPart = {
    text?: string
    inlineData?: {
        mimeType?: string
        data?: string
    }
    inline_data?: {
        mime_type?: string
        data?: string
    }
}

type GeminiTtsResponse = {
    candidates?: Array<{
        content?: {
            parts?: GeminiTtsPart[]
        }
    }>
    error?: {
        message?: string
        code?: number
    }
}

type YeScaleGeminiTtsPayload = {
    model: string
    contents: Array<{
        parts: Array<{ text: string }>
    }>
    generationConfig: {
        responseModalities: ['AUDIO']
        speechConfig?: {
            multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: Array<{
                    speaker: string
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: string
                        }
                    }
                }>
            }
        }
    }
}

type WavFormat = {
    audioFormat: number
    numChannels: number
    sampleRate: number
    byteRate: number
    blockAlign: number
    bitsPerSample: number
}

const YESCALE_GEMINI_TTS_MODELS = new Set([
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts',
])

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function readStringOption(options: GenerateOptions, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = readString(options[key])
        if (value) return value
    }
    return undefined
}

function readBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined
}

function readFiniteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readPlaybackSpeed(value: unknown): number | undefined {
    const numeric = readFiniteNumber(value)
    if (numeric && numeric > 0) return numeric
    const raw = readString(value)
    if (!raw) return undefined

    const percentMatch = /^([+-]?\d+(?:\.\d+)?)%$/.exec(raw)
    if (percentMatch) {
        const delta = Number.parseFloat(percentMatch[1])
        if (Number.isFinite(delta)) {
            const speed = 1 + delta / 100
            return speed > 0 ? speed : undefined
        }
    }

    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function readStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    const normalized = value.filter(isNonEmptyString).map((item) => item.trim())
    return normalized.length > 0 ? normalized : undefined
}

function buildWavBuffer(format: WavFormat, pcmData: Buffer): Buffer {
    const headerSize = 44
    const output = Buffer.allocUnsafe(headerSize + pcmData.length)
    output.write('RIFF', 0, 'ascii')
    output.writeUInt32LE(36 + pcmData.length, 4)
    output.write('WAVE', 8, 'ascii')
    output.write('fmt ', 12, 'ascii')
    output.writeUInt32LE(16, 16)
    output.writeUInt16LE(format.audioFormat, 20)
    output.writeUInt16LE(format.numChannels, 22)
    output.writeUInt32LE(format.sampleRate, 24)
    output.writeUInt32LE(format.byteRate, 28)
    output.writeUInt16LE(format.blockAlign, 32)
    output.writeUInt16LE(format.bitsPerSample, 34)
    output.write('data', 36, 'ascii')
    output.writeUInt32LE(pcmData.length, 40)
    pcmData.copy(output, 44)
    return output
}

function parsePcmMimeMetadata(mimeType: string | undefined): WavFormat {
    const normalized = (mimeType || '').toLowerCase()
    const sampleRateMatch = /rate=(\d+)/.exec(normalized)
    const sampleRate = sampleRateMatch ? Number.parseInt(sampleRateMatch[1], 10) : 24000
    const numChannels = /stereo|channels=2/.test(normalized) ? 2 : 1
    const bitsPerSample = /l24/.test(normalized) ? 24 : 16
    const blockAlign = numChannels * (bitsPerSample / 8)
    return {
        audioFormat: 1,
        numChannels,
        sampleRate,
        byteRate: sampleRate * blockAlign,
        blockAlign,
        bitsPerSample,
    }
}

function parseGeminiInlineAudio(response: GeminiTtsResponse): { audioData: Buffer; mimeType: string } {
    const parts = response.candidates?.[0]?.content?.parts || []
    for (const part of parts) {
        const inlineData = part.inlineData || part.inline_data
        if (!inlineData) continue
        const data = inlineData?.data
        if (typeof data !== 'string' || data.length === 0) continue

        const mimeType = 'mimeType' in inlineData
            ? (inlineData.mimeType || 'audio/L16;codec=pcm;rate=24000')
            : ((inlineData as { mime_type?: string }).mime_type || 'audio/L16;codec=pcm;rate=24000')
        const rawAudio = Buffer.from(data, 'base64')
        if (mimeType.toLowerCase().includes('pcm') || mimeType.toLowerCase().includes('l16')) {
            const wavData = buildWavBuffer(parsePcmMimeMetadata(mimeType), rawAudio)
            return { audioData: wavData, mimeType: 'audio/wav' }
        }
        return { audioData: rawAudio, mimeType }
    }

    throw new Error('YESCALE_GEMINI_TTS_MISSING_AUDIO')
}

function inferAspectRatio(options: GenerateOptions): string | undefined {
    const direct = readString(options.aspectRatio)
    if (direct) return direct
    const resolution = readString(options.resolution)
    if (resolution?.includes(':')) return resolution
    return undefined
}

function inferSize(options: GenerateOptions): string | undefined {
    const direct = readString(options.size)
    if (direct) return direct
    const resolution = readString(options.resolution)
    if (resolution && !resolution.includes(':')) return resolution
    return undefined
}

function mapAspectRatioToGptImageSize(aspectRatio: string | undefined): string {
    switch ((aspectRatio || '').trim()) {
        case '16:9':
        case '3:2':
            return '1536x1024'
        case '9:16':
        case '2:3':
            return '1024x1536'
        default:
            return '1024x1024'
    }
}

function normalizeNanoBanana2Thinking(value: unknown): string | undefined {
    const normalized = readString(value)
    if (!normalized) return undefined

    switch (normalized) {
        case 'high':
            return 'high'
        case 'minimal':
        case 'low':
        case 'medium':
            return 'minimal'
        default:
            return undefined
    }
}

function buildNanoBanana2ImageConfig(referenceImages: string[] | undefined, options: GenerateOptions): Record<string, unknown> {
    const thinking = normalizeNanoBanana2Thinking(options.thinking)
    const config: Record<string, unknown> = {
        aspect_ratio: inferAspectRatio(options) || '1:1',
        size: inferSize(options) || '1K',
        google_search: readStringOption(options, 'googleSearch', 'google_search') || 'disable',
        thinking: thinking || 'minimal',
    }
    if (referenceImages?.length) {
        config.images = referenceImages.slice(0, 3)
    }
    return config
}

function buildNanoBananaProImageConfig(referenceImages: string[] | undefined, options: GenerateOptions): Record<string, unknown> {
    const config: Record<string, unknown> = {
        aspect_ratio: inferAspectRatio(options) || '1:1',
        size: inferSize(options) || '1K',
        google_search: readBoolean(options.googleSearch) ?? false,
    }
    if (referenceImages?.length) {
        config.images = referenceImages.slice(0, 3)
    }
    return config
}

function buildSeedreamImageConfig(referenceImages: string[] | undefined, options: GenerateOptions): Record<string, unknown> {
    const config: Record<string, unknown> = {
        size: inferSize(options) || '1K',
    }
    if (referenceImages?.length) {
        config.images = referenceImages.slice(0, 10)
    }
    const sequentialImageGeneration = readString(options.sequentialImageGeneration)
    if (sequentialImageGeneration) {
        config.sequential_image_generation = sequentialImageGeneration
    }
    return config
}

function buildGptImageConfig(referenceImages: string[] | undefined, options: GenerateOptions): Record<string, unknown> {
    const aspectRatio = inferAspectRatio(options)
    const config: Record<string, unknown> = {
        background: readString(options.background) || 'opaque',
        quality: readString(options.quality) || 'medium',
        size: inferSize(options) || mapAspectRatioToGptImageSize(aspectRatio),
    }
    if (referenceImages?.length) {
        config.images = referenceImages.slice(0, 5)
    }
    return config
}

export function buildYeScaleAudioSpeechPayload(input: {
    modelId: string
    text: string
    options?: GenerateOptions
}): YeScaleAudioSpeechPayload {
    const options = input.options || {}
    const speed = readPlaybackSpeed(options.rate)

    return {
        model: input.modelId,
        input: input.text,
        voice: readStringOption(options, 'voice', 'voiceId') || 'alloy',
        response_format: 'mp3',
        ...(speed && speed !== 1 ? { speed } : {}),
    }
}

export function buildYeScaleGeminiTtsPayload(input: {
    modelId: string
    text: string
    options?: GenerateOptions
}): YeScaleGeminiTtsPayload {
    const options = input.options || {}
    const voiceName = readStringOption(options, 'voice', 'voiceId')
    const speakerName = readStringOption(options, 'speakerName') || 'Speaker'
    const text = voiceName ? `${speakerName}: ${input.text}` : input.text

    return {
        model: input.modelId,
        contents: [
            {
                parts: [{ text }],
            },
        ],
        generationConfig: {
            responseModalities: ['AUDIO'],
            ...(voiceName ? {
                speechConfig: {
                    multiSpeakerVoiceConfig: {
                        speakerVoiceConfigs: [
                            {
                                speaker: speakerName,
                                voiceConfig: {
                                    prebuiltVoiceConfig: {
                                        voiceName,
                                    },
                                },
                            },
                        ],
                    },
                },
            } : {}),
        },
    }
}

export function buildYeScaleImageSubmitPayload(input: {
    modelId: string
    prompt: string
    referenceImages?: string[]
    options?: GenerateOptions
}): YeScaleSubmitPayload {
    const options = input.options || {}
    let config: Record<string, unknown>

    switch (input.modelId) {
        case 'nano-banana-2':
            config = buildNanoBanana2ImageConfig(input.referenceImages, options)
            break
        case 'nano-banana-pro':
            config = buildNanoBananaProImageConfig(input.referenceImages, options)
            break
        case 'seedream-4.0':
        case 'seedream-4.5':
            config = buildSeedreamImageConfig(input.referenceImages, options)
            break
        case 'gpt-image':
            config = buildGptImageConfig(input.referenceImages, options)
            break
        default:
            throw new Error(`YESCALE_IMAGE_MODEL_UNSUPPORTED: ${input.modelId}`)
    }

    return {
        model: input.modelId,
        prompt: input.prompt,
        config,
    }
}

function buildVeoVideoConfig(imageUrl: string, options: GenerateOptions): Record<string, unknown> {
    const lastFrameImageUrl = readStringOption(options, 'lastFrameImageUrl')
    const images = lastFrameImageUrl ? [imageUrl, lastFrameImageUrl] : [imageUrl]
    const config: Record<string, unknown> = {
        images,
    }
    const aspectRatio = inferAspectRatio(options)
    const size = inferSize(options)
    if (aspectRatio) {
        config.aspect_ratio = aspectRatio
    }
    if (size) {
        config.size = size
    }
    const enhancePrompt = readBoolean(options.enhancePrompt)
    if (enhancePrompt !== undefined) {
        config.enhance_prompt = enhancePrompt
    }
    return config
}

function buildKlingVideoConfig(imageUrl: string, options: GenerateOptions): Record<string, unknown> {
    return {
        duration: readFiniteNumber(options.duration) || 5,
        aspect_ratio: inferAspectRatio(options) || '16:9',
        images: [imageUrl],
    }
}

function buildHailuoVideoConfig(imageUrl: string, options: GenerateOptions): Record<string, unknown> {
    return {
        duration: readFiniteNumber(options.duration) || 6,
        size: inferSize(options) || '720P',
        images: [imageUrl],
    }
}

export function buildYeScaleVideoSubmitPayload(input: {
    modelId: string
    prompt: string
    imageUrl: string
    options?: GenerateOptions
}): YeScaleSubmitPayload {
    const options = input.options || {}
    const lastFrameImageUrl = readStringOption(options, 'lastFrameImageUrl')
    let config: Record<string, unknown>

    switch (input.modelId) {
        case 'veo-3.1':
            config = buildVeoVideoConfig(input.imageUrl, options)
            break
        case 'kling-2.5-turbo':
            if (lastFrameImageUrl) {
                throw new Error(`YESCALE_VIDEO_OPTION_UNSUPPORTED: lastFrameImageUrl for ${input.modelId}`)
            }
            config = buildKlingVideoConfig(input.imageUrl, options)
            break
        case 'hailuo-2.3':
            if (lastFrameImageUrl) {
                throw new Error(`YESCALE_VIDEO_OPTION_UNSUPPORTED: lastFrameImageUrl for ${input.modelId}`)
            }
            config = buildHailuoVideoConfig(input.imageUrl, options)
            break
        default:
            throw new Error(`YESCALE_VIDEO_MODEL_UNSUPPORTED: ${input.modelId}`)
    }

    return {
        model: input.modelId,
        prompt: input.prompt,
        config,
    }
}

async function submitYeScaleTask(userId: string, modelId: string, payload: YeScaleSubmitPayload): Promise<{ taskId: string; keyGroup?: string }> {
    const { apiKey, keyGroup } = await getProviderConfig(userId, 'yescale', { modelId })
    const response = await fetch(`${YESCALE_MEDIA_BASE_URL}/task/submit`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    })

    const rawText = await response.text().catch(() => '')
    let data: YeScaleSubmitResponse = {}
    if (rawText.trim()) {
        try {
            data = JSON.parse(rawText) as YeScaleSubmitResponse
        } catch {
            throw new Error(`YESCALE_SUBMIT_RESPONSE_INVALID: ${rawText.slice(0, 200)}`)
        }
    }

    if (!response.ok) {
        const errorMessage = readString(data.error) || readString(data.message) || rawText.slice(0, 200) || `HTTP ${response.status}`
        throw new Error(`YESCALE_SUBMIT_FAILED: ${errorMessage}`)
    }

    const taskId = readString(data.task_id)
    if (!taskId) {
        throw new Error('YESCALE_SUBMIT_MISSING_TASK_ID')
    }
    return { taskId, keyGroup }
}

export class YEScaleImageGenerator extends BaseImageGenerator {
    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages, options = {} } = params
        const modelId = readString(options.modelId)
        if (!modelId) {
            throw new Error('YESCALE_IMAGE_OPTION_REQUIRED: modelId')
        }

        const payload = buildYeScaleImageSubmitPayload({
            modelId,
            prompt,
            referenceImages,
            options,
        })
        _ulogInfo(`[YEScale Image] submit model=${modelId}`)
        try {
            const { taskId, keyGroup } = await submitYeScaleTask(userId, modelId, payload)
            return {
                success: true,
                async: true,
                requestId: taskId,
                externalId: keyGroup
                    ? `YESCALE:IMAGE:${keyGroup}:${taskId}`
                    : `YESCALE:IMAGE:${taskId}`,
            }
        } catch (error) {
            _ulogError('[YEScale Image] submit failed', error)
            throw error
        }
    }
}

export class YEScaleVideoGenerator extends BaseVideoGenerator {
    protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
        const { userId, imageUrl, prompt = '', options = {} } = params
        const modelId = readString(options.modelId)
        if (!modelId) {
            throw new Error('YESCALE_VIDEO_OPTION_REQUIRED: modelId')
        }

        const payload = buildYeScaleVideoSubmitPayload({
            modelId,
            prompt,
            imageUrl,
            options,
        })
        _ulogInfo(`[YEScale Video] submit model=${modelId}`)
        try {
            const { taskId, keyGroup } = await submitYeScaleTask(userId, modelId, payload)
            return {
                success: true,
                async: true,
                requestId: taskId,
                externalId: keyGroup
                    ? `YESCALE:VIDEO:${keyGroup}:${taskId}`
                    : `YESCALE:VIDEO:${taskId}`,
            }
        } catch (error) {
            _ulogError('[YEScale Video] submit failed', error)
            throw error
        }
    }
}

export class YEScaleAudioGenerator extends BaseAudioGenerator {
    protected async doGenerate(params: AudioGenerateParams): Promise<GenerateResult> {
        const modelId = readString(params.options?.modelId)
        if (!modelId) {
            throw new Error('YESCALE_AUDIO_OPTION_REQUIRED: modelId')
        }

        const isGeminiTts = YESCALE_GEMINI_TTS_MODELS.has(modelId)

        if (isGeminiTts) {
            const payload = buildYeScaleGeminiTtsPayload({
                modelId,
                text: params.text,
                options: {
                    ...(params.options || {}),
                    voice: params.voice,
                    rate: params.rate,
                },
            })

            const { apiKey } = await getProviderConfig(params.userId, 'yescale', { modelId })
            const response = await fetch(`${YESCALE_MEDIA_BASE_URL}/v1beta/models/${encodeURIComponent(modelId)}:generateContent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify(payload),
            })

            const rawText = await response.text().catch(() => '')
            let data: GeminiTtsResponse = {}
            if (rawText.trim()) {
                try {
                    data = JSON.parse(rawText) as GeminiTtsResponse
                } catch {
                    throw new Error(`YESCALE_GEMINI_TTS_RESPONSE_INVALID: ${rawText.slice(0, 300)}`)
                }
            }

            if (!response.ok || data.error) {
                const message = readString(data.error?.message) || rawText.slice(0, 300) || `HTTP ${response.status}`
                throw new Error(`YESCALE_GEMINI_TTS_FAILED: ${message}`)
            }

            const resolved = parseGeminiInlineAudio(data)
            return {
                success: true,
                audioUrl: `data:${resolved.mimeType};base64,${resolved.audioData.toString('base64')}`,
            }
        }

        const payload = buildYeScaleAudioSpeechPayload({
            modelId,
            text: params.text,
            options: {
                ...(params.options || {}),
                voice: params.voice,
                rate: params.rate,
            },
        })

        const { apiKey } = await getProviderConfig(params.userId, 'yescale', { modelId })
        const response = await fetch(`${YESCALE_MEDIA_BASE_URL}/v1/audio/speech`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        })

        if (!response.ok) {
            const contentType = response.headers.get('content-type') || ''
            const rawText = contentType.includes('application/json')
                ? JSON.stringify(await response.json().catch(() => ({})))
                : await response.text().catch(() => '')
            throw new Error(`YESCALE_AUDIO_FAILED(${response.status}): ${rawText.slice(0, 300)}`)
        }

        const audioBytes = Buffer.from(await response.arrayBuffer())
        if (audioBytes.length === 0) {
            throw new Error('YESCALE_AUDIO_EMPTY_RESPONSE')
        }

        return {
            success: true,
            audioUrl: `data:audio/mpeg;base64,${audioBytes.toString('base64')}`,
        }
    }
}