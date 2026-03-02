import { ApiError } from './client'

type ParsedApiError = {
  message: string
  hint?: string
  field?: string
  payload?: any
  status?: number
}

export function parseApiError(error: unknown, fallbackMessage = 'Request failed'): ParsedApiError {
  if (error instanceof ApiError) {
    let payload: any
    try {
      payload = JSON.parse(error.message)
    } catch {
      payload = undefined
    }

    const rawError = payload?.error
    const rawMessage = payload?.message
    const message =
      (typeof rawError === 'string' && rawError.trim()) ||
      (typeof rawMessage === 'string' && rawMessage.trim()) ||
      (typeof error.message === 'string' && error.message.trim()) ||
      `HTTP ${error.status}`

    const hint = typeof payload?.hint === 'string' ? payload.hint : undefined
    const field = typeof payload?.field === 'string' ? payload.field : undefined

    return { message, hint, field, payload, status: error.status }
  }

  if (error instanceof Error) {
    return { message: error.message || fallbackMessage }
  }

  return { message: fallbackMessage }
}

export function getUiErrorMessage(error: unknown, fallbackMessage = 'Request failed'): string {
  return parseApiError(error, fallbackMessage).message
}

export async function getErrorMessageFromResponse(response: Response): Promise<string> {
  const status = response.status
  const statusText = response.statusText || 'Error'
  const contentType = response.headers.get('content-type') || ''

  let bodyText = ''
  try {
    bodyText = await response.text()
  } catch {
    bodyText = ''
  }

  let message = ''
  if (bodyText) {
    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(bodyText)
        message = parsed?.error || parsed?.message || ''
      } catch {
        message = ''
      }
    }

    if (!message) {
      try {
        const parsed = JSON.parse(bodyText)
        message = parsed?.error || parsed?.message || ''
      } catch {
        message = ''
      }
    }

    if (!message) {
      message = bodyText
    }
  }

  if (status >= 500) {
    return (
      'Authentication service is temporarily unavailable. ' +
      'Please try again in a moment. ' +
      'If this persists, check that the backend and database are running.'
    )
  }

  return message || `HTTP ${status}: ${statusText}`
}
