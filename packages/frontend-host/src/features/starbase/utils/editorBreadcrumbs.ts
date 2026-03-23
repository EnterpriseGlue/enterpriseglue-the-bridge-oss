export type EditorBreadcrumbEntry = {
  fileId: string
  fileName: string | null
}

type EditorBreadcrumbState = {
  breadcrumbTrail?: EditorBreadcrumbEntry[]
  fromEditor?: EditorBreadcrumbEntry
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function normalizeFileName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? value : null
}

export function normalizeEditorBreadcrumbEntry(value: unknown): EditorBreadcrumbEntry | null {
  const record = toObject(value)
  if (!record) return null

  const rawFileId = record.fileId
  const fileId = typeof rawFileId === 'string' ? rawFileId.trim() : ''
  if (!fileId) return null

  return {
    fileId,
    fileName: normalizeFileName(record.fileName),
  }
}

function normalizeEditorBreadcrumbTrail(values: unknown, currentFileId?: string | null): EditorBreadcrumbEntry[] {
  if (!Array.isArray(values)) return []

  const entries: EditorBreadcrumbEntry[] = []
  for (const value of values) {
    const entry = normalizeEditorBreadcrumbEntry(value)
    if (!entry) continue
    if (currentFileId && entry.fileId === currentFileId) continue
    entries.push(entry)
  }

  return entries
}

export function getEditorBreadcrumbTrail(currentState: unknown, currentFileId?: string | null): EditorBreadcrumbEntry[] {
  const state = toObject(currentState)
  if (!state) return []

  const trail = normalizeEditorBreadcrumbTrail(state.breadcrumbTrail, currentFileId)
  const legacyEntry = normalizeEditorBreadcrumbEntry(state.fromEditor)

  if (!legacyEntry || (currentFileId && legacyEntry.fileId === currentFileId)) {
    return trail
  }

  if (trail.length === 0) {
    return [legacyEntry]
  }

  const lastTrailEntry = trail[trail.length - 1]
  if (!lastTrailEntry || (lastTrailEntry.fileId === legacyEntry.fileId && lastTrailEntry.fileName === legacyEntry.fileName)) {
    return trail
  }

  return [...trail, legacyEntry]
}

export function buildEditorBreadcrumbState(
  trail: EditorBreadcrumbEntry[],
  extraState?: Record<string, unknown>
): EditorBreadcrumbState & Record<string, unknown> | undefined {
  const normalizedTrail = normalizeEditorBreadcrumbTrail(trail)
  const state: Record<string, unknown> = { ...(extraState ?? {}) }

  if (normalizedTrail.length > 0) {
    state.breadcrumbTrail = normalizedTrail
    state.fromEditor = normalizedTrail[normalizedTrail.length - 1]
  }

  return Object.keys(state).length > 0 ? (state as EditorBreadcrumbState & Record<string, unknown>) : undefined
}

export function buildEditorNavigationState(params: {
  currentState: unknown
  currentFileId?: string | null
  currentFileName?: string | null
  extraState?: Record<string, unknown>
}): (EditorBreadcrumbState & Record<string, unknown>) | undefined {
  const currentFileId = typeof params.currentFileId === 'string' ? params.currentFileId.trim() : ''
  const trail = getEditorBreadcrumbTrail(params.currentState, currentFileId || null)

  if (currentFileId) {
    trail.push({
      fileId: currentFileId,
      fileName: normalizeFileName(params.currentFileName),
    })
  }

  return buildEditorBreadcrumbState(trail, params.extraState)
}

export function buildEditorBreadcrumbBackState(
  trail: EditorBreadcrumbEntry[],
  targetIndex: number,
  extraState?: Record<string, unknown>
): (EditorBreadcrumbState & Record<string, unknown>) | undefined {
  const safeIndex = Number.isInteger(targetIndex) && targetIndex > 0 ? targetIndex : 0
  return buildEditorBreadcrumbState(trail.slice(0, safeIndex), extraState)
}
