import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@enterpriseglue/shared/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { logger } from '@enterpriseglue/shared/utils/logger.js'
import { TimestampedTypeOrmLogger } from '@enterpriseglue/shared/db/TimestampedTypeOrmLogger.js'

describe('TimestampedTypeOrmLogger', () => {
  const typeormLogger = new TimestampedTypeOrmLogger()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs queries through the shared logger', () => {
    typeormLogger.logQuery('SELECT 1')

    expect(logger.info).toHaveBeenCalledWith('query: SELECT 1')
  })

  it('logs query parameters when present', () => {
    typeormLogger.logQuery('SELECT * FROM users WHERE id = $1', ['u1'])

    expect(logger.info).toHaveBeenCalledWith('query: SELECT * FROM users WHERE id = $1 -- PARAMETERS: ["u1"]')
  })

  it('logs query errors through the shared logger', () => {
    typeormLogger.logQueryError('boom', 'SELECT 1', ['u1'])

    expect(logger.error).toHaveBeenNthCalledWith(1, 'query failed: SELECT 1 -- PARAMETERS: ["u1"]')
    expect(logger.error).toHaveBeenNthCalledWith(2, 'error: boom')
  })

  it('logs slow queries through the shared logger', () => {
    typeormLogger.logQuerySlow(125, 'SELECT 1')

    expect(logger.warn).toHaveBeenCalledWith('query is slow: 125 ms: SELECT 1')
  })
})
