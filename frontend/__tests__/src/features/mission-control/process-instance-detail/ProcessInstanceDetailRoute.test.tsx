import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProcessInstanceDetailRoute from '@src/features/mission-control/process-instance-detail/ProcessInstanceDetailRoute'
import { useVariableEditor } from '@src/features/mission-control/process-instance-detail/components/hooks/useVariableEditor'
import { modifyProcessInstanceVariables } from '@src/features/mission-control/process-instance-detail/api/processInstances'

const queries = vi.hoisted(() => ({ refetch: vi.fn() }))
const auth = vi.hoisted(() => ({ user: { id: 'actor-a', session: { tenant: { id: 'tenant-a' } } }, sessionRevision: 1,
  permissions: { authorizationVersion: 'v1' } }))
vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => auth }))

vi.mock('@src/features/mission-control/process-instance-detail/api/processInstances', () => ({ modifyProcessInstanceVariables: vi.fn() }))
// Retain the real editor hook while excluding BPMN rendering and unrelated data
// queries. The production route must replace all process-local action state.
vi.mock('@src/features/mission-control/process-instance-detail/ProcessInstanceDetailPage', () => ({
  default: function ActionProbe() {
    const { instanceId = '' } = useParams()
    const editor = useVariableEditor({ instanceId, engineId: 'same-engine', varsQ: queries })
    return <>
      <span data-testid="instance">{instanceId}</span>
      <span data-testid="draft">{editor.editingVarKey || 'closed'}</span>
      <button onClick={() => editor.openVariableEditor('details', { type: 'Json', value: { instanceId } })}>Open editor</button>
      <button onClick={() => void editor.submitVariableEdit()}>Save</button>
    </>
  },
}))

function tree() {
  return <MemoryRouter initialEntries={['/t/tenant-a/instances/a']}>
    <Link to="/t/tenant-a/instances/a">Instance A</Link><Link to="/t/tenant-a/instances/b">Instance B</Link>
    <Link to="/t/tenant-b/instances/a">Other tenant</Link>
    <Link to="/t/tenant-a/instances/a?tab=variables">Same instance</Link>
    <Routes><Route path="/t/:tenantSlug/instances/:instanceId" element={<ProcessInstanceDetailRoute />} /></Routes>
  </MemoryRouter>
}
function mount() { return render(tree()) }

describe('process-instance route action scope', () => {
  beforeEach(() => { vi.clearAllMocks(); auth.user.id = 'actor-a'; auth.sessionRevision = 1; auth.permissions = { authorizationVersion: 'v1' }; vi.mocked(modifyProcessInstanceVariables).mockResolvedValue(undefined) })

  it.each(['actor', 'session', 'authorization', 'availability'])('discards the current draft when %s changes without navigation', async change => {
    const view = mount()
    fireEvent.click(screen.getByText('Open editor'))
    if (change === 'actor') auth.user.id = 'actor-b'
    if (change === 'session') auth.sessionRevision++
    if (change === 'authorization') auth.permissions.authorizationVersion = 'v2'
    if (change === 'availability') Object.assign(auth.permissions, { platformActionAvailability: { allowedActions: [], restrictions: {} } })
    view.rerender(tree())
    expect(screen.getByTestId('draft')).toHaveTextContent('closed')
    await act(async () => fireEvent.click(screen.getByText('Save')))
    expect(modifyProcessInstanceVariables).not.toHaveBeenCalled()
  })

  it('discards a late mutation completion after the session changes on the same process', async () => {
    let settle!: () => void
    vi.mocked(modifyProcessInstanceVariables).mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve }))
    const view = mount()
    fireEvent.click(screen.getByText('Open editor'))
    await act(async () => fireEvent.click(screen.getByText('Save')))
    auth.sessionRevision++
    view.rerender(tree())
    await act(async () => { settle() })
    expect(queries.refetch).not.toHaveBeenCalled()
    expect(screen.getByTestId('draft')).toHaveTextContent('closed')
  })

  it('discards an open A edit before rendering B on the same engine', async () => {
    mount()
    fireEvent.click(screen.getByText('Open editor'))
    expect(screen.getByTestId('draft')).toHaveTextContent('details')
    fireEvent.click(screen.getByText('Instance B'))
    expect(screen.getByTestId('instance')).toHaveTextContent('b')
    expect(screen.getByTestId('draft')).toHaveTextContent('closed')
    await act(async () => fireEvent.click(screen.getByText('Save')))
    expect(modifyProcessInstanceVariables).not.toHaveBeenCalled()
  })

  it('does not revive the original draft after A to B to A navigation', () => {
    mount()
    fireEvent.click(screen.getByText('Open editor'))
    fireEvent.click(screen.getByText('Instance B'))
    fireEvent.click(screen.getByText('Instance A'))
    expect(screen.getByTestId('draft')).toHaveTextContent('closed')
  })

  it('preserves the current draft when only same-instance query parameters change', () => {
    mount()
    fireEvent.click(screen.getByText('Open editor'))
    fireEvent.click(screen.getByText('Same instance'))
    expect(screen.getByTestId('draft')).toHaveTextContent('details')
  })

  it('discards action state on tenant navigation even when instance IDs match', () => {
    mount()
    fireEvent.click(screen.getByText('Open editor'))
    fireEvent.click(screen.getByText('Other tenant'))
    expect(screen.getByTestId('draft')).toHaveTextContent('closed')
  })

  it('does not refetch under a new route when an old mutation finishes late', async () => {
    let settle!: () => void
    vi.mocked(modifyProcessInstanceVariables).mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve }))
    mount()
    fireEvent.click(screen.getByText('Open editor'))
    await act(async () => fireEvent.click(screen.getByText('Save')))
    expect(modifyProcessInstanceVariables).toHaveBeenCalledWith('a', expect.objectContaining({ engineId: 'same-engine' }))
    fireEvent.click(screen.getByText('Other tenant'))
    await act(async () => { settle() })
    expect(queries.refetch).not.toHaveBeenCalled()
    expect(screen.getByTestId('draft')).toHaveTextContent('closed')
  })
})
