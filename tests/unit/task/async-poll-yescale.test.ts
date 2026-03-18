import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderConfigMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'yescale',
    apiKey: 'ys-key',
  })),
)

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

vi.mock('@/lib/async-submit', () => ({
  queryFalStatus: vi.fn(),
}))

vi.mock('@/lib/async-task-utils', () => ({
  queryGeminiBatchStatus: vi.fn(),
  queryGoogleVideoStatus: vi.fn(),
  querySeedanceVideoStatus: vi.fn(),
}))

import { pollAsyncTask } from '@/lib/async-poll'

describe('async poll YEScale task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns pending while yescale task is processing', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        task_id: 'task-running',
        status: 'PROCESSING',
      }),
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await pollAsyncTask('YESCALE:IMAGE:task-running', 'user-1')

    expect(getProviderConfigMock).toHaveBeenCalledWith('user-1', 'yescale', { keyGroup: undefined })
    expect(fetchMock).toHaveBeenCalledWith('https://api.yescale.io/task/task-running', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ys-key',
      },
    })
    expect(result).toEqual({ status: 'pending' })
  })

  it('returns completed image url on success', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        task_id: 'task-success',
        status: 'SUCCESS',
        task_result: {
          images: [{ url: 'https://cdn.yescale.vip/result.png' }],
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await pollAsyncTask('YESCALE:IMAGE:task-success', 'user-1')

    expect(result).toEqual({
      status: 'completed',
      resultUrl: 'https://cdn.yescale.vip/result.png',
      imageUrl: 'https://cdn.yescale.vip/result.png',
    })
  })

  it('uses grouped YEScale key metadata when present in external id', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        task_id: 'task-grouped',
        status: 'PROCESSING',
      }),
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await pollAsyncTask('YESCALE:IMAGE:drawing:task-grouped', 'user-1')

    expect(getProviderConfigMock).toHaveBeenCalledWith('user-1', 'yescale', { keyGroup: 'drawing' })
  })

  it('returns failed reason when task fails', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        task_id: 'task-failed',
        status: 'FAILURE',
        err_reason: 'quota exceeded',
      }),
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await pollAsyncTask('YESCALE:VIDEO:task-failed', 'user-1')

    expect(result).toEqual({
      status: 'failed',
      error: 'YEScale: quota exceeded',
    })
  })
})