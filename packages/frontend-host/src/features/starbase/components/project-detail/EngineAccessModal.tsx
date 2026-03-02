import React from 'react'
import {
  ComposedModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  InlineLoading,
  InlineNotification,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  Tag,
  Dropdown,
  Toggletip,
  ToggletipButton,
  ToggletipContent,
} from '@carbon/react'
import { Information } from '@carbon/icons-react'

interface EngineAccessData {
  accessedEngines: Array<{
    engineId: string
    engineName: string
    baseUrl?: string
    environment?: { name: string; color: string }
    health?: { status: string; latencyMs?: number }
  }>
  pendingRequests: Array<{
    requestId: string
    engineName: string
    requestedAt: number
  }>
  availableEngines: Array<{
    id: string
    name: string
  }>
}

interface EngineAccessModalProps {
  open: boolean
  onClose: () => void
  engineAccessQ: {
    isLoading: boolean
    isError: boolean
    data?: EngineAccessData
  }
  canManageMembers: boolean
  myMembershipLoading: boolean
  selectedEngineForRequest: string | null
  setSelectedEngineForRequest: (id: string | null) => void
  requestEngineAccessM: {
    isPending: boolean
    mutate: (engineId: string) => void
  }
}

export function EngineAccessModal({
  open,
  onClose,
  engineAccessQ,
  canManageMembers,
  myMembershipLoading,
  selectedEngineForRequest,
  setSelectedEngineForRequest,
  requestEngineAccessM,
}: EngineAccessModalProps) {
  if (!open) return null

  return (
    <ComposedModal open size="md" onClose={onClose}>
      <ModalHeader label="Project settings" title="Engine access" closeModal={onClose} />
      <ModalBody>
        {engineAccessQ.isLoading && (
          <InlineLoading description="Loading engine access..." style={{ marginTop: 'var(--spacing-3)' }} />
        )}
        {engineAccessQ.isError && (
          <InlineNotification lowContrast kind="error" title="Failed to load engine access" style={{ marginTop: 'var(--spacing-3)' }} />
        )}
        {!engineAccessQ.isLoading && !engineAccessQ.isError && engineAccessQ.data && (
          <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
            {/* Engines with access */}
            <div>
              <h5 style={{ marginBottom: 'var(--spacing-3)', fontSize: 14, fontWeight: 600 }}>Connected engines</h5>
              <p style={{ fontSize: 12, color: 'var(--cds-text-secondary)', marginBottom: 'var(--spacing-3)' }}>
                This project can deploy BPMN/DMN files to these engines.
              </p>
              {engineAccessQ.data.accessedEngines.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--cds-text-secondary)' }}>No engines connected yet. Request access below to deploy your processes.</p>
              ) : (
                <Table size="sm">
                  <TableHead>
                    <TableRow>
                      <TableHeader>Engine</TableHeader>
                      <TableHeader>Environment</TableHeader>
                      <TableHeader>Health</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {engineAccessQ.data.accessedEngines.map((e) => (
                      <TableRow key={e.engineId}>
                        <TableCell>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontWeight: 500 }}>{e.engineName}</span>
                            {e.baseUrl && (
                              <Toggletip align="bottom" autoAlign>
                                <ToggletipButton label="Show base URL">
                                  <Information size={16} style={{ color: 'var(--cds-icon-secondary)' }} />
                                </ToggletipButton>
                                <ToggletipContent>
                                  <p style={{ fontSize: 12, margin: 0 }}><strong>Base URL:</strong><br />{e.baseUrl}</p>
                                </ToggletipContent>
                              </Toggletip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {e.environment ? (
                            <Tag size="sm" style={{ backgroundColor: e.environment.color, color: '#fff' }}>
                              {e.environment.name}
                            </Tag>
                          ) : (
                            <span style={{ color: 'var(--cds-text-secondary)' }}>—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {e.health ? (
                            <Tag size="sm" type={e.health.status === 'connected' ? 'green' : 'red'}>
                              {e.health.status === 'connected' ? 'Connected' : 'Disconnected'}
                              {e.health.latencyMs != null && e.health.status === 'connected' && (
                                <span style={{ marginLeft: 4, opacity: 0.8 }}>{e.health.latencyMs}ms</span>
                              )}
                            </Tag>
                          ) : (
                            <span style={{ color: 'var(--cds-text-secondary)' }}>—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            {/* Pending requests */}
            {engineAccessQ.data.pendingRequests.length > 0 && (
              <div>
                <h5 style={{ marginBottom: 'var(--spacing-3)', fontSize: 14, fontWeight: 600 }}>Pending requests</h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
                  {engineAccessQ.data.pendingRequests.map((r) => (
                    <div key={r.requestId} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', padding: 'var(--spacing-2)', background: 'var(--cds-layer-01)', borderRadius: 4 }}>
                      <Tag type="blue" size="sm">Pending</Tag>
                      <span style={{ flex: 1 }}>{r.engineName}</span>
                      <span style={{ fontSize: 12, color: 'var(--cds-text-secondary)' }}>
                        Requested {new Date(r.requestedAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Request access to new engine */}
            {engineAccessQ.data.availableEngines.length > 0 && (
              <div>
                <h5 style={{ marginBottom: 'var(--spacing-3)', fontSize: 14, fontWeight: 600 }}>Connect to another engine</h5>
                {(canManageMembers || myMembershipLoading) ? (
                  <>
                    <div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <Dropdown
                          id="request-engine-access"
                          titleText=""
                          label="Select an engine"
                          items={engineAccessQ.data.availableEngines}
                          itemToString={(item: any) => item?.name || ''}
                          selectedItem={engineAccessQ.data.availableEngines.find((e) => e.id === selectedEngineForRequest) || null}
                          onChange={({ selectedItem }: any) => setSelectedEngineForRequest(selectedItem?.id || null)}
                        />
                      </div>
                      <Button
                        kind="primary"
                        size="md"
                        disabled={!selectedEngineForRequest || requestEngineAccessM.isPending || myMembershipLoading}
                        onClick={() => selectedEngineForRequest && requestEngineAccessM.mutate(selectedEngineForRequest)}
                      >
                        {requestEngineAccessM.isPending ? 'Requesting...' : 'Request access'}
                      </Button>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--cds-text-secondary)', marginTop: 'var(--spacing-2)' }}>
                      The engine owner will need to approve your request. If you own both the project and engine, access is granted automatically.
                    </p>
                  </>
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--cds-text-secondary)' }}>
                    Only project owners and delegates can request engine access. Contact a project owner to connect this project to an engine.
                  </p>
                )}
              </div>
            )}

            {engineAccessQ.data.availableEngines.length === 0 && engineAccessQ.data.accessedEngines.length > 0 && (
              <p style={{ fontSize: 13, color: 'var(--cds-text-secondary)' }}>
                This project is connected to all available engines.
              </p>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button kind="secondary" onClick={onClose}>Close</Button>
      </ModalFooter>
    </ComposedModal>
  )
}
