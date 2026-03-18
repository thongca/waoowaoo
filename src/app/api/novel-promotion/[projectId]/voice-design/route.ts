import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { prisma } from '@/lib/prisma'
import { validatePreviewText, validateVoicePrompt } from '@/lib/providers/bailian/voice-design'

async function ensureVoiceDesignSupportedForAudioModel(userId: string, audioModel: string | null | undefined) {
  const normalizedAudioModel = typeof audioModel === 'string' ? audioModel.trim() : ''
  if (!normalizedAudioModel) return

  const selection = await resolveModelSelectionOrSingle(userId, normalizedAudioModel, 'audio')
  const providerKey = getProviderKey(selection.provider).toLowerCase()
  if (providerKey === 'bailian') return

  throw new ApiError('INVALID_PARAMS', {
    code: 'VOICE_DESIGN_PROVIDER_UNSUPPORTED',
    field: 'audioModel',
    provider: providerKey,
    modelKey: normalizedAudioModel,
    message: 'Design AI currently only supports Bailian voice design. Switch the active audio model to a Bailian voice model and try again.',
  })
}

/**
 * 声音设计 API
 * POST /api/novel-promotion/[projectId]/voice-design
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const locale = resolveRequiredTaskLocale(request, body)
  const voicePrompt = typeof body.voicePrompt === 'string' ? body.voicePrompt.trim() : ''
  const previewText = typeof body.previewText === 'string' ? body.previewText.trim() : ''
  const preferredName = typeof body.preferredName === 'string' && body.preferredName.trim()
    ? body.preferredName.trim()
    : 'custom_voice'
  const language = body.language === 'en' ? 'en' : 'zh'

  const [projectData, userPref] = await Promise.all([
    prisma.novelPromotionProject.findUnique({
      where: { projectId },
      select: { audioModel: true },
    }),
    prisma.userPreference.findUnique({
      where: { userId: session.user.id },
      select: { audioModel: true },
    }),
  ])

  await ensureVoiceDesignSupportedForAudioModel(
    session.user.id,
    projectData?.audioModel || userPref?.audioModel || null,
  )

  const promptValidation = validateVoicePrompt(voicePrompt)
  if (!promptValidation.valid) {
    throw new ApiError('INVALID_PARAMS', {
      field: 'voicePrompt',
      message: promptValidation.error || 'Invalid voice prompt',
    })
  }
  const textValidation = validatePreviewText(previewText)
  if (!textValidation.valid) {
    throw new ApiError('INVALID_PARAMS', {
      field: 'previewText',
      message: textValidation.error || 'Invalid preview text',
    })
  }

  const digest = createHash('sha1')
    .update(`${session.user.id}:${projectId}:${voicePrompt}:${previewText}:${preferredName}:${language}`)
    .digest('hex')
    .slice(0, 16)

  const payload = {
    voicePrompt,
    previewText,
    preferredName,
    language,
    displayMode: 'detail' as const}

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.VOICE_DESIGN,
    targetType: 'NovelPromotionProject',
    targetId: projectId,
    payload,
    dedupeKey: `${TASK_TYPE.VOICE_DESIGN}:${digest}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_DESIGN, payload)})

  return NextResponse.json(result)
})
