import React from 'react'
import {
  ComposedModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  InlineLoading,
  InlineNotification,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  Tag,
} from '@carbon/react'
import { getFileIcon } from './project-detail-utils'

interface EngineDeploymentsModalProps {
  open: boolean
  onClose: () => void
  myEnginesQ: { isLoading: boolean; isError: boolean; data?: any[]; error?: any }
  projectFilesQ: { isLoading: boolean; isError: boolean; data?: any[]; error?: any }
  engineDeploymentsLatestQ: { isLoading: boolean; isError: boolean; data?: any[]; error?: any }
  engineDeploymentsHistoryQ: { isLoading: boolean; isError: boolean; data?: any[]; error?: any }
}

export function EngineDeploymentsModal({
  open,
  onClose,
  myEnginesQ,
  projectFilesQ,
  engineDeploymentsLatestQ,
  engineDeploymentsHistoryQ,
}: EngineDeploymentsModalProps) {
  if (!open) return null

  const isLoading = myEnginesQ.isLoading || projectFilesQ.isLoading || 
    engineDeploymentsLatestQ.isLoading || engineDeploymentsHistoryQ.isLoading
  const isError = myEnginesQ.isError || projectFilesQ.isError || 
    engineDeploymentsLatestQ.isError || engineDeploymentsHistoryQ.isError
  const errorMessage = (myEnginesQ.error as any)?.message || 
    (projectFilesQ.error as any)?.message || 
    (engineDeploymentsLatestQ.error as any)?.message || 
    (engineDeploymentsHistoryQ.error as any)?.message || 'Unknown error'

  const engines = (Array.isArray(myEnginesQ.data) ? myEnginesQ.data : [])
    .map((e: any) => ({
      id: String(e?.engine?.id || ''),
      name: String(e?.engine?.name || e?.engine?.baseUrl || 'Engine'),
      environmentTag: e?.environmentTag?.name ? String(e.environmentTag.name) : null,
    }))
    .filter((e: any) => e.id)

  const fileRows = (Array.isArray(projectFilesQ.data) ? projectFilesQ.data : [])
    .filter((f: any) => String(f.type) === 'bpmn' || String(f.type) === 'dmn')
    .map((f: any) => ({
      id: String(f.id),
      name: String(f.name || ''),
      type: String(f.type) as 'bpmn' | 'dmn',
      updatedAt: f?.updatedAt !== null && typeof f?.updatedAt !== 'undefined' ? Number(f.updatedAt) : null,
    }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name))

  const latestRows = Array.isArray(engineDeploymentsLatestQ.data) ? engineDeploymentsLatestQ.data : []
  const latestByKey = new Map<string, any>()
  for (const r0 of latestRows as any[]) {
    const eid = String(r0.engineId || '')
    const fid = String(r0.fileId || '')
    if (!eid || !fid) continue
    latestByKey.set(`${eid}:${fid}`, r0)
  }

  const historyRows = Array.isArray(engineDeploymentsHistoryQ.data) ? engineDeploymentsHistoryQ.data : []

  return (
    <ComposedModal open size="lg" onClose={onClose}>
      <ModalHeader label="Deploy" title="Engine deployments" closeModal={onClose} />
      <ModalBody>
        {isLoading && (
          <InlineLoading description="Loading deployments…" style={{ marginTop: 'var(--spacing-3)' }} />
        )}
        {isError && (
          <InlineNotification
            kind="error"
            lowContrast
            title="Failed to load deployments"
            subtitle={errorMessage}
            style={{ marginTop: 'var(--spacing-3)' }}
          />
        )}

        {!isLoading && !isError && (
          <Tabs>
            <TabList aria-label="Engine deployments tabs">
              <Tab>Latest</Tab>
              <Tab>History</Tab>
            </TabList>
            <TabPanels>
              <TabPanel>
                {engines.length === 0 ? (
                  <div style={{ fontSize: 'var(--text-13)', color: 'var(--color-text-tertiary)', marginTop: 'var(--spacing-3)' }}>
                    No engines available.
                  </div>
                ) : (
                  <div style={{ marginTop: 'var(--spacing-3)', overflowX: 'auto' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-3)' }}>
                      Latest shows the most recently recorded deployed versions per file on each engine.
                    </div>
                    <Table size="sm">
                      <TableHead>
                        <TableRow>
                          <TableHeader>File</TableHeader>
                          {engines.map((e: any) => (
                            <TableHeader key={e.id} colSpan={3}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <div style={{ whiteSpace: 'nowrap' }}>{e.name}</div>
                                {e.environmentTag && (
                                  <div style={{ display: 'flex' }}>
                                    <Tag size="sm" type="gray">{e.environmentTag}</Tag>
                                  </div>
                                )}
                              </div>
                            </TableHeader>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableHeader />
                          {engines.map((e: any) => (
                            <React.Fragment key={e.id}>
                              <TableHeader>Engine</TableHeader>
                              <TableHeader>Starbase</TableHeader>
                              <TableHeader>Git</TableHeader>
                            </React.Fragment>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {fileRows.map((f: any) => (
                          <TableRow key={f.id}>
                            <TableCell>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {getFileIcon(f.type)}
                                <div style={{ whiteSpace: 'nowrap' }}>{f.name.replace(/\.(bpmn|dmn)$/i, '')}</div>
                              </div>
                            </TableCell>
                            {engines.map((e: any) => {
                              const r0 = latestByKey.get(`${e.id}:${f.id}`)
                              if (!r0) {
                                return (
                                  <React.Fragment key={`${e.id}:${f.id}`}>
                                    <TableCell style={{ color: 'var(--color-text-tertiary)' }}>—</TableCell>
                                    <TableCell style={{ color: 'var(--color-text-tertiary)' }}>—</TableCell>
                                    <TableCell style={{ color: 'var(--color-text-tertiary)' }}>—</TableCell>
                                  </React.Fragment>
                                )
                              }

                              const artifacts = Array.isArray(r0.artifacts) ? r0.artifacts : []
                              const relevant = f.type === 'bpmn'
                                ? artifacts.filter((a: any) => String(a.kind) === 'process')
                                : artifacts.filter((a: any) => String(a.kind) === 'decision')

                              const versions = relevant.map((a: any) => Number(a.version)).filter((n: any) => Number.isFinite(n))
                              const maxV = versions.length ? Math.max(...versions) : null
                              const suffix = versions.length > 1 ? ` (+${versions.length - 1})` : ''

                              const drd = f.type === 'dmn' ? artifacts.filter((a: any) => String(a.kind) === 'drd') : []
                              const drdVersions = drd.map((a: any) => Number(a.version)).filter((n: any) => Number.isFinite(n))
                              const maxDrdV = drdVersions.length ? Math.max(...drdVersions) : null
                              const drdSuffix = drdVersions.length > 1 ? ` (+${drdVersions.length - 1})` : ''

                              const deployedHash = typeof r0.fileContentHash === 'string' && r0.fileContentHash ? String(r0.fileContentHash).slice(0, 7) : null
                              const deployedUpdatedAt = r0.fileUpdatedAt !== null && typeof r0.fileUpdatedAt !== 'undefined' ? Number(r0.fileUpdatedAt) : null
                              const isStale = !!(f.updatedAt && deployedUpdatedAt && f.updatedAt !== deployedUpdatedAt)

                              const gitSha = typeof r0.gitCommitSha === 'string' && r0.gitCommitSha ? String(r0.gitCommitSha).slice(0, 7) : null
                              const fileGitMsg = typeof r0.fileGitCommitMessage === 'string' && r0.fileGitCommitMessage ? String(r0.fileGitCommitMessage) : null
                              const deployGitMsg = typeof r0.gitCommitMessage === 'string' && r0.gitCommitMessage ? String(r0.gitCommitMessage) : null
                              const hasGitMeta = !!(
                                (typeof r0.gitDeploymentId === 'string' && r0.gitDeploymentId) ||
                                (typeof r0.gitCommitSha === 'string' && r0.gitCommitSha)
                              )

                              return (
                                <React.Fragment key={`${e.id}:${f.id}`}>
                                  <TableCell>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <div style={{ fontWeight: 500 }}>
                                        {f.type === 'bpmn'
                                          ? (maxV ? `Process v${maxV}${suffix}` : 'Process —')
                                          : (maxV || maxDrdV)
                                            ? `${maxV ? `Decision v${maxV}${suffix}` : ''}${maxV && maxDrdV ? ' / ' : ''}${maxDrdV ? `DRD v${maxDrdV}${drdSuffix}` : ''}`
                                            : '—'}
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <div style={{ fontSize: 12, color: isStale ? 'var(--color-text-warning)' : 'var(--color-text-tertiary)' }}>
                                        {deployedHash ? `Starbase ${deployedHash}${isStale ? ' (changed)' : ''}` : `Starbase —${isStale ? ' (changed)' : ''}`}
                                      </div>
                                      {r0.deployedAt && (
                                        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                                          {new Date(Number(r0.deployedAt)).toLocaleString()}
                                        </div>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    {hasGitMeta && (gitSha || fileGitMsg || deployGitMsg) ? (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        {gitSha && (<div style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>Git {gitSha}</div>)}
                                        {(fileGitMsg || deployGitMsg) && (
                                          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{fileGitMsg || deployGitMsg}</div>
                                        )}
                                      </div>
                                    ) : (
                                      <div style={{ color: 'var(--color-text-tertiary)' }}>—</div>
                                    )}
                                  </TableCell>
                                </React.Fragment>
                              )
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabPanel>
              <TabPanel>
                {historyRows.length === 0 ? (
                  <div style={{ fontSize: 'var(--text-13)', color: 'var(--color-text-tertiary)', marginTop: 'var(--spacing-3)' }}>
                    No deployment history yet.
                  </div>
                ) : (
                  <div style={{ marginTop: 'var(--spacing-3)', overflowX: 'auto' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-3)' }}>
                      History shows each deployment event recorded by Starbase.
                    </div>
                    <Table size="sm">
                      <TableHead>
                        <TableRow>
                          <TableHeader>Deployed at</TableHeader>
                          <TableHeader>Engine</TableHeader>
                          <TableHeader>Environment</TableHeader>
                          <TableHeader>Git</TableHeader>
                          <TableHeader>Resources</TableHeader>
                          <TableHeader>Status</TableHeader>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {historyRows.map((r0: any) => (
                          <TableRow key={String(r0.id)}>
                            <TableCell style={{ whiteSpace: 'nowrap' }}>
                              {r0.deployedAt ? new Date(Number(r0.deployedAt)).toLocaleString() : ''}
                            </TableCell>
                            <TableCell style={{ whiteSpace: 'nowrap' }}>
                              {String(r0.engineName || r0.engineBaseUrl || r0.engineId || '')}
                            </TableCell>
                            <TableCell>
                              {r0.environmentTag ? (<Tag size="sm" type="gray">{String(r0.environmentTag)}</Tag>) : '—'}
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const sha = typeof r0.gitCommitSha === 'string' && r0.gitCommitSha ? String(r0.gitCommitSha).slice(0, 7) : null
                                const msg = typeof r0.gitCommitMessage === 'string' && r0.gitCommitMessage ? String(r0.gitCommitMessage) : null
                                if (!sha && !msg) return '—'
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {sha && (<div style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>Git {sha}</div>)}
                                    {msg && (<div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{msg}</div>)}
                                  </div>
                                )
                              })()}
                            </TableCell>
                            <TableCell>{Number(r0.resourceCount || 0)}</TableCell>
                            <TableCell>{String(r0.status || 'success')}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabPanel>
            </TabPanels>
          </Tabs>
        )}
      </ModalBody>
      <ModalFooter>
        <Button kind="primary" onClick={onClose}>Close</Button>
      </ModalFooter>
    </ComposedModal>
  )
}
