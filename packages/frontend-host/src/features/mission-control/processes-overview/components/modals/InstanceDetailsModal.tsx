import React from 'react'
import { Modal } from '@carbon/react'
import type { ActivityInstance, Variables } from '@enterpriseglue/shared/schemas/mission-control/process.js'

interface InstanceDetailsModalProps {
  open: boolean
  instanceId: string | null
  onClose: () => void
  histQLoading: boolean
  histQData: ActivityInstance[] | undefined
  varsQLoading: boolean
  varsQData: Variables | undefined
}

export function InstanceDetailsModal({
  open,
  instanceId,
  onClose,
  histQLoading,
  histQData,
  varsQLoading,
  varsQData,
}: InstanceDetailsModalProps) {
  return (
    <Modal 
      open={open} 
      onRequestClose={onClose} 
      passiveModal 
      modalHeading={instanceId ? `Instance ${instanceId}` : 'Instance'}
    >
      <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
        <section>
          <h4 style={{ margin: 0 }}>History</h4>
          {histQLoading ? <p>Loading...</p> : null}
          {histQData && histQData.length === 0 ? <p>No activity history.</p> : null}
          {histQData && histQData.length > 0 && (
            <ul>
              {histQData.map((a) => (
                <li key={a.id}>{a.activityName || a.activityId} — {a.endTime ? 'done' : 'active'}</li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h4 style={{ margin: 0 }}>Variables</h4>
          {varsQLoading ? <p>Loading...</p> : null}
          {varsQData && Object.keys(varsQData).length === 0 ? <p>No variables.</p> : null}
          {varsQData && Object.keys(varsQData).length > 0 && (
            <table className="cds--data-table" style={{ width: '100%' }}>
              <thead>
                <tr><th>Name</th><th>Value</th><th>Type</th></tr>
              </thead>
              <tbody>
                {Object.entries(varsQData).map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td>{String(v.value)}</td><td>{v.type}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </Modal>
  )
}
