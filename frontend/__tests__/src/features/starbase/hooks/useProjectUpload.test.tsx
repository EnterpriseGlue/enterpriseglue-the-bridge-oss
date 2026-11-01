import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, beforeEach, expect, it, vi } from 'vitest'
import { useProjectUpload } from '@src/features/starbase/hooks/useProjectUpload'
import { apiClient } from '@src/shared/api/client'
import { advanceBrowserSessionRevision } from '@src/utils/browserSession'
vi.mock('@src/shared/api/client', async original => ({ ...await original<typeof import('@src/shared/api/client')>(), apiClient: { post: vi.fn(), postRaw: vi.fn() } }))
const projectId = '11111111-1111-4111-8111-111111111111', folderId = '22222222-2222-4222-8222-222222222222'
const xml = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="p"/></definitions>'
const receipt = { id: '33333333-3333-4333-8333-333333333333', name: 'Order.bpmn', type: 'bpmn', bpmnProcessId: 'p', dmnDecisionId: null, createdAt: 1, updatedAt: 1 }
function deferred() { let resolve!: (v: any) => void; const promise = new Promise<any>(done => { resolve = done }); return { promise, resolve } }
function fixture(strict = false) {
  const queryClient = { invalidateQueries: vi.fn().mockResolvedValue(undefined) }, showToast = vi.fn()
  const props = { projectId, folderId: null as string | null, authority: 'owner/session/permissions-1', allowed: true }
  const f = renderHook((context: typeof props) => useProjectUpload({ ...context, queryClient: queryClient as any, showToast }), { initialProps: props, wrapper: ({ children }) => strict ? <React.StrictMode>{children}</React.StrictMode> : children })
  const input = { click: vi.fn(), value: 'selected', files: null as any } as unknown as HTMLInputElement
  const select = (file: any) => { Object.defineProperty(input, 'files', { configurable: true, value: [file] }); return f.result.current.onChange({ currentTarget: input } as any) }
  return { ...f, props, input, select, queryClient, showToast }
}
describe('project upload ownership', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(apiClient.post).mockResolvedValue(receipt); vi.mocked(apiClient.postRaw).mockResolvedValue({ foldersCreated: 1, filesCreated: 1, linksRewritten: 0, warnings: [] }) })
  it('owns the selected input and acknowledges a canonical upload in StrictMode', async () => {
    const f = fixture(true); act(() => f.result.current.openPicker(f.input))
    await act(async () => { await f.select({ name: 'Order.bpmn', text: async () => xml }) })
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith(`/starbase-api/projects/${projectId}/files`, { name: 'Order.bpmn', type: 'bpmn', folderId: null, xml })
    expect(f.input.value).toBe(''); expect(f.showToast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' })); expect(f.result.current.busy).toBe(false)
  })
  it('refuses a selection that did not originate in the current picker', async () => {
    const f = fixture(); await act(async () => { await f.select({ name: 'Order.bpmn', text: async () => xml }) }); expect(apiClient.post).not.toHaveBeenCalled()
  })
  it.each(['folder', 'project', 'authority', 'denial', 'browser', 'unmount', 'ABA'])('does not dispatch a file read after %s context changes', async kind => {
    const f = fixture(), read = deferred(); act(() => f.result.current.openPicker(f.input)); let pending!: Promise<void>
    act(() => { pending = f.select({ name: 'Order.bpmn', text: () => read.promise }) })
    act(() => {
      if (kind === 'folder') f.rerender({ ...f.props, folderId })
      if (kind === 'project') f.rerender({ ...f.props, projectId: folderId })
      if (kind === 'authority') f.rerender({ ...f.props, authority: 'replacement-session' })
      if (kind === 'denial') f.rerender({ ...f.props, allowed: false })
      if (kind === 'browser') advanceBrowserSessionRevision()
      if (kind === 'unmount') f.unmount()
      if (kind === 'ABA') { f.rerender({ ...f.props, folderId }); }
    })
    if (kind === 'ABA') f.rerender(f.props)
    await act(async () => { read.resolve(xml); await pending })
    expect(apiClient.post).not.toHaveBeenCalled(); expect(f.showToast).not.toHaveBeenCalled(); expect(f.queryClient.invalidateQueries).not.toHaveBeenCalled()
  })
  it('refuses a picker result after changing folder even before reading the file', async () => {
    const f = fixture(), text = vi.fn().mockResolvedValue(xml); act(() => f.result.current.openPicker(f.input)); f.rerender({ ...f.props, folderId })
    await act(async () => { await f.select({ name: 'Order.bpmn', text }) }); expect(text).not.toHaveBeenCalled(); expect(apiClient.post).not.toHaveBeenCalled()
  })
  it('does not announce an old write after replacing the authority', async () => {
    const f = fixture(), response = deferred(); vi.mocked(apiClient.post).mockReturnValue(response.promise)
    act(() => f.result.current.openPicker(f.input)); let pending!: Promise<void>; act(() => { pending = f.select({ name: 'Order.bpmn', text: async () => xml }) })
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1)); f.rerender({ ...f.props, authority: 'other' })
    await act(async () => { response.resolve(receipt); await pending }); expect(f.showToast).not.toHaveBeenCalled(); expect(f.queryClient.invalidateQueries).not.toHaveBeenCalled()
  })
  it('blocks duplicate selection and picker reopening while a request is pending', async () => {
    const f = fixture(), response = deferred(); vi.mocked(apiClient.post).mockReturnValue(response.promise)
    act(() => f.result.current.openPicker(f.input)); let pending!: Promise<void>; act(() => { pending = f.select({ name: 'Order.bpmn', text: async () => xml }) })
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1)); act(() => f.result.current.openPicker(f.input)); await act(async () => { await f.select({ name: 'Order.bpmn', text: async () => xml }) })
    expect(f.input.click).toHaveBeenCalledTimes(1); expect(apiClient.post).toHaveBeenCalledTimes(1); await act(async () => { response.resolve(receipt); await pending })
  })
  it('requires reconciliation after an uncertain receipt instead of replaying', async () => {
    const f = fixture(); vi.mocked(apiClient.post).mockResolvedValue({})
    act(() => f.result.current.openPicker(f.input)); await act(async () => { await f.select({ name: 'Order.bpmn', text: async () => xml }) })
    expect(f.result.current.unavailableReason).toMatch(/Refresh project contents/); act(() => f.result.current.openPicker(f.input)); expect(f.input.click).toHaveBeenCalledTimes(1)
  })
  it('imports ZIP archives at the project root even when a folder is selected', async () => {
    const f = fixture(); f.rerender({ ...f.props, folderId }); act(() => f.result.current.openPicker(f.input))
    await act(async () => { await f.select({ name: 'Project.zip', type: 'application/zip', arrayBuffer: async () => new Uint8Array([1, 2]).buffer }) })
    expect(apiClient.postRaw).toHaveBeenCalledWith(`/starbase-api/projects/${projectId}/import-zip`, expect.any(ArrayBuffer), { headers: { 'Content-Type': 'application/zip' } }); expect(f.showToast).toHaveBeenCalledWith(expect.objectContaining({ subtitle: 'Project.zip · imported at project root' }))
  })
  it('does not open a picker when creation is denied', () => { const f = fixture(); f.rerender({ ...f.props, allowed: false }); act(() => f.result.current.openPicker(f.input)); expect(f.input.click).not.toHaveBeenCalled() })
})
