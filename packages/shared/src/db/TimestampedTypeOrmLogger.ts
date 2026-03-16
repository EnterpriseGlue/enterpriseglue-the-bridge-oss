import type { Logger as TypeOrmLogger, QueryRunner } from 'typeorm'
import { logger } from '../utils/logger.js'

function formatParameters(parameters?: unknown[]): string {
  if (!Array.isArray(parameters) || parameters.length === 0) return ''
  try {
    return ` -- PARAMETERS: ${JSON.stringify(parameters)}`
  } catch {
    return ` -- PARAMETERS: ${String(parameters)}`
  }
}

function formatMessage(message: unknown): string {
  if (typeof message === 'string') return message
  try {
    return JSON.stringify(message)
  } catch {
    return String(message)
  }
}

export class TimestampedTypeOrmLogger implements TypeOrmLogger {
  logQuery(query: string, parameters?: unknown[], _queryRunner?: QueryRunner): void {
    logger.info(`query: ${query}${formatParameters(parameters)}`)
  }

  logQueryError(error: string | Error, query: string, parameters?: unknown[], _queryRunner?: QueryRunner): void {
    logger.error(`query failed: ${query}${formatParameters(parameters)}`)
    logger.error(`error: ${formatMessage(error instanceof Error ? error.message : error)}`)
  }

  logQuerySlow(time: number, query: string, parameters?: unknown[], _queryRunner?: QueryRunner): void {
    logger.warn(`query is slow: ${time} ms: ${query}${formatParameters(parameters)}`)
  }

  logSchemaBuild(message: string, _queryRunner?: QueryRunner): void {
    logger.info(`schema build: ${message}`)
  }

  logMigration(message: string, _queryRunner?: QueryRunner): void {
    logger.info(`migration: ${message}`)
  }

  log(level: 'log' | 'info' | 'warn', message: unknown, _queryRunner?: QueryRunner): void {
    const formatted = formatMessage(message)
    if (level === 'warn') {
      logger.warn(formatted)
      return
    }
    logger.info(formatted)
  }
}
