import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiClient } from '../../../../shared/api/client'
import { getAccessibleEngines, getManageableEngines } from './engines'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('engine inventory API', () => {
  it('returns the authorization-filtered engine array', async () => {
    const engines = [{ id: 'engine-1', name: 'Operaton', baseUrl: 'https://engine.invalid' }]
    vi.spyOn(apiClient, 'get').mockResolvedValueOnce(engines)

    await expect(getAccessibleEngines()).resolves.toEqual(engines)
  })

  it('fails safely when a frontend-only host returns its HTML shell', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValueOnce('<!doctype html>')

    await expect(getAccessibleEngines()).rejects.toThrow(
      'The engine inventory response is not an array',
    )
  })

  it('validates the manageable inventory contract too', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ items: [] })

    await expect(getManageableEngines()).rejects.toThrow(
      'The manageable engine inventory response is not an array',
    )
    expect(get).toHaveBeenCalledWith(
      '/engines-api/engines',
      { includeManageableShared: 'true' },
      expect.objectContaining({ credentials: 'include' }),
    )
  })
})
