import React from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { getBrowserSessionRevision } from '../../../utils/browserSession'
import { validateAndUploadFile, validateAndUploadProjectArchive } from '../utils/uploadValidation'

type UploadContext = {
  projectId: string | undefined
  folderId: string | null
  authority: string
  allowed: boolean
  queryClient: QueryClient
  showToast: (value: { kind: 'success' | 'error'; title: string; subtitle?: string }) => void
}

export function useProjectUpload(context: UploadContext) {
  const scope = JSON.stringify([context.projectId, context.folderId, context.authority, context.allowed])
  const state = React.useRef({ scope, generation: 0, browser: getBrowserSessionRevision() })
  if (state.current.scope !== scope) state.current = { scope, generation: state.current.generation + 1, browser: getBrowserSessionRevision() }
  const mounted = React.useRef(true), active = React.useRef<object | null>(null)
  const picker = React.useRef<number | null>(null)
  const [busy, setBusy] = React.useState(false), [uncertain, setUncertain] = React.useState(false)
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; state.current.generation++ } }, [])
  React.useEffect(() => { active.current = null; picker.current = null; setBusy(false); setUncertain(false) }, [scope])
  const unavailableReason = !context.allowed ? 'Missing permission to create project files'
    : uncertain ? 'Refresh project contents before another upload'
      : busy ? 'Upload in progress' : null

  const openPicker = (input: HTMLInputElement | null) => {
    if (!mounted.current || !input || !context.allowed || active.current || uncertain || state.current.browser !== getBrowserSessionRevision()) return
    picker.current = state.current.generation
    input.click()
  }
  const onChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget, file = input.files?.[0]
    // Clear only the selected input before awaits; never a replacement view's ref.
    input.value = ''
    const generation = picker.current, browser = state.current.browser
    picker.current = null
    const current = () => mounted.current && context.allowed && generation !== null && generation === state.current.generation && browser === getBrowserSessionRevision()
    if (!file || !current() || active.current || uncertain) return
    const operation = {}; active.current = operation; setBusy(true)
    const assertCurrent = () => { if (!current()) throw new Error('Upload context changed') }
    try {
      const params = { file, projectId: context.projectId || '', folderId: context.folderId, queryClient: context.queryClient,
        showToast: context.showToast, assertCurrent, onUncertain: () => { if (current()) setUncertain(true) } }
      const zip = file.name.toLowerCase().endsWith('.zip') || ['application/zip', 'application/x-zip-compressed'].includes(file.type)
      if (zip) await validateAndUploadProjectArchive(params)
      else await validateAndUploadFile(params)
    } finally {
      if (active.current === operation) { active.current = null; if (mounted.current) setBusy(false) }
    }
  }
  return { openPicker, onChange, busy, unavailableReason }
}
