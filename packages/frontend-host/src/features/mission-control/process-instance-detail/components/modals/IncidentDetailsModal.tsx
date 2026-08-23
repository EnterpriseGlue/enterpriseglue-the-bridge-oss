import React from 'react'
import { Modal } from '@carbon/react'
import { NativePluginSlotV1 } from '../../../../../plugins/nativePluginRuntime'
import {
  HostContextualFlowContentV1,
  useHostContextualFlowSurfaceV1,
} from '../../../../../plugins/contextualFlowRuntime'
import { useActionDecision } from '../../../../../shared/auth/guards'

interface IncidentDetailsModalProps {
  incidentDetails: any | null
  engineRef?: string
  jobById: Map<string, any>
  onClose: () => void
}

/**
 * Modal displaying detailed information about a process incident
 * Shows incident metadata, job details, error messages, and stack traces
 */
export function IncidentDetailsModal({
  incidentDetails,
  engineRef,
  jobById,
  onClose,
}: IncidentDetailsModalProps) {
  const contextualFlowSurface = useHostContextualFlowSurfaceV1()
  const pluginActionDecision = useActionDecision(
    'engine.instances.read',
    { type: 'engine', id: engineRef ?? null },
  )
  if (!incidentDetails) return null

  const jobId = incidentDetails?.configuration || incidentDetails?.jobId || ''
  const incidentRef = typeof incidentDetails?.id === 'string' ? incidentDetails.id : ''
  const job = jobId ? jobById.get(jobId) : null
  const due = job?.dueDate || job?.duedate
  const activeFlow = contextualFlowSurface.active

  const closeModal = () => {
    if (activeFlow) {
      contextualFlowSurface.close(activeFlow.ownerPluginId, 'closed')
    }
    onClose()
  }
  
  const formatTS = (val?: string) => {
    if (!val) return '—'
    const d = new Date(val)
    return isNaN(d.getTime()) ? String(val) : d.toISOString().replace('T', ' ').slice(0, 19)
  }

  return (
    <Modal
      open
      danger={false}
      modalHeading={activeFlow?.request.title ?? `Incident — ${incidentDetails.activityId || 'Flow node'}`}
      primaryButtonText="Close"
      secondaryButtonText={activeFlow ? (activeFlow.request.backLabel ?? 'Back to incident') : (undefined as unknown as string)}
      onSecondarySubmit={() => {
        if (activeFlow) contextualFlowSurface.back(activeFlow.ownerPluginId)
      }}
      onRequestSubmit={closeModal}
      onRequestClose={closeModal}
      size="lg"
    >
      {activeFlow ? (
        <HostContextualFlowContentV1 surface={contextualFlowSurface} />
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: 'var(--text-13)' }}>
          <div><strong>Flow node:</strong> {incidentDetails.activityId || '—'}</div>
          <div><strong>Incident type:</strong> {incidentDetails.incidentType || incidentDetails.type || '—'}</div>
          <div><strong>Job ID:</strong> {jobId || '—'}</div>
          <div><strong>Created:</strong> {formatTS(incidentDetails.incidentTimestamp || incidentDetails.createTime || incidentDetails.timestamp)}</div>
          <div><strong>Retries:</strong> {typeof job?.retries === 'number' ? job.retries : '—'}</div>
          <div><strong>Due date:</strong> {due ? formatTS(due) : '—'}</div>
          <div><strong>Worker topic:</strong> {job?.topic || job?.topicName || '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--text-13)', marginBottom: '4px' }}><strong>Error message</strong></div>
          <pre style={{ background: 'var(--color-bg-secondary)', padding: 'var(--spacing-2)', borderRadius: 'var(--border-radius-md)', maxHeight: '40vh', overflow: 'auto', fontSize: 'var(--text-12)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {incidentDetails?.incidentMessage || incidentDetails?.message || job?.exceptionMessage || job?.errorMessage || 'No error details provided.'}
          </pre>
        </div>
        {engineRef && (incidentRef || jobId) && (
          <div
            aria-label="Plugin incident actions"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--spacing-2)',
            }}
          >
            {incidentRef ? (
              <NativePluginSlotV1
                slot="mission-control.incident.actions.v1"
                context={{
                  schemaVersion: 1,
                  disabled: !pluginActionDecision.allowed,
                  engineRef,
                  incidentRef,
                  ...(incidentDetails.activityId
                    ? { displayName: String(incidentDetails.activityId) }
                    : {}),
                }}
                contextualFlowSurface={contextualFlowSurface}
              />
            ) : jobId ? (
              <NativePluginSlotV1
                slot="mission-control.failed-job.actions.v1"
                context={{
                  schemaVersion: 1,
                  disabled: !pluginActionDecision.allowed,
                  engineRef,
                  failedJobRef: jobId,
                }}
                contextualFlowSurface={contextualFlowSurface}
              />
            ) : null}
          </div>
        )}
        <div>
          <div style={{ fontSize: 'var(--text-13)', marginBottom: '4px' }}><strong>Exception stacktrace</strong></div>
          <pre style={{ background: 'var(--color-bg-secondary)', padding: 'var(--spacing-2)', borderRadius: 'var(--border-radius-md)', maxHeight: '30vh', overflow: 'auto', fontSize: 'var(--text-12)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {job?.exceptionStacktrace || 'Not available.'}
          </pre>
        </div>
      </div>
      )}
    </Modal>
  )
}
