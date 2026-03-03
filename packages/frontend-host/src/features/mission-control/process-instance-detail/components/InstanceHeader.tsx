import React from 'react'
import { useTenantNavigate } from '../../../../shared/hooks/useTenantNavigate'
import { Button } from '@carbon/react'
import { Pause, Play, TrashCan, Copy } from '@carbon/icons-react'
import { WrenchIcon } from './Icons'

interface InstanceHeaderProps {
  instanceId: string
  defName: string
  defKey: string
  defVersion: number
  status: 'ACTIVE' | 'SUSPENDED' | 'COMPLETED' | 'CANCELED' | 'EXTERNALLY_TERMINATED' | 'INTERNALLY_TERMINATED'
  startTime: string
  endTime?: string | null
  parentId?: string | null
  incidentCount: number
  onSuspend: () => void
  onResume: () => void
  onModify: () => void
  onTerminate: () => void
  onRetry: () => void
}

/**
 * Header bar for process instance detail view
 * Shows instance metadata, status, and action buttons
 */
export function InstanceHeader({
  instanceId,
  defName,
  defKey,
  defVersion,
  status,
  startTime,
  endTime,
  parentId,
  incidentCount,
  onSuspend,
  onResume,
  onModify,
  onTerminate,
  onRetry,
}: InstanceHeaderProps) {
  const { tenantNavigate } = useTenantNavigate()

  const formatTimestamp = (ts: string) => {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const calculateDuration = () => {
    const startDate = new Date(startTime)
    const endDate = endTime ? new Date(endTime) : new Date()
    const diffMs = endDate.getTime() - startDate.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const days = Math.floor(diffMins / 1440)
    const hours = Math.floor((diffMins % 1440) / 60)
    const minutes = diffMins % 60

    let duration = ''
    if (days > 0) duration += `${days}d `
    if (hours > 0 || days > 0) duration += `${hours}h `
    duration += `${minutes}m`
    return duration.trim()
  }

  const showIncidentBanner = incidentCount > 0

  return (
    <>
      {/* Main header bar */}
      <div style={{ borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-primary)', color: 'white', width: '100%', height: '36px', minHeight: '36px', maxHeight: '36px' }}>
        <div style={{ paddingLeft: 'var(--spacing-4)', paddingRight: 'var(--spacing-4)', height: '100%', display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr auto 1.1fr auto 0.45fr auto 2.3fr auto 1.3fr auto minmax(120px, auto)', gap: 'var(--spacing-3)', alignItems: 'center', width: '100%' }}>
          {/* Process Definition Name */}
          <div style={{ fontSize: 'var(--text-14)', fontWeight: 500, color: 'white' }}>
            {defName}
          </div>
          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.3)' }}></div>

          {/* Instance ID with copy button */}
          <div style={{ fontSize: 'var(--text-14)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
            <button
              className="cds--link"
              style={{ border: 'none', background: 'transparent', padding: 0, color: 'white', fontSize: 'var(--text-14)', fontWeight: 500 }}
              onClick={() => tenantNavigate(`/mission-control/processes/instances/${instanceId}`)}
              title={instanceId}
            >
              {instanceId.length > 15 ? `${instanceId.slice(0, 6)}...${instanceId.slice(-6)}` : instanceId}
            </button>
            <button
              style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              onClick={() => navigator.clipboard.writeText(instanceId)}
              title="Copy full instance ID"
            >
              <Copy size={16} style={{ fill: 'white' }} />
            </button>
          </div>
          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.3)' }}></div>

          {/* Version */}
          <div style={{ fontSize: 'var(--text-14)', fontWeight: 500, color: 'white' }}>
            <span style={{ background: 'rgba(255, 255, 255, 0.15)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255, 255, 255, 0.3)', color: 'white', padding: '1px 4px', borderRadius: '3px' }}>
              ver.
            </span>
            {' '}{defVersion}
          </div>
          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.3)' }}></div>

          {/* Start/End Time and Duration */}
          <div style={{ fontSize: 'var(--text-14)', fontWeight: 500, color: 'white' }}>
            {endTime ? (
              <>
                <span style={{ background: 'rgba(255, 255, 255, 0.15)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255, 255, 255, 0.3)', color: 'white', padding: '1px 4px', borderRadius: '3px' }}>
                  Started
                </span>
                {' '}{formatTimestamp(startTime)} to {formatTimestamp(endTime)} ({calculateDuration()})
              </>
            ) : (
              <>
                <span style={{ background: 'rgba(255, 255, 255, 0.15)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255, 255, 255, 0.3)', color: 'white', padding: '1px 4px', borderRadius: '3px' }}>
                  Started
                </span>
                {' '}{formatTimestamp(startTime)} ({calculateDuration()})
              </>
            )}
          </div>
          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.3)' }}></div>

          {/* Parent Process */}
          <div style={{ fontSize: 'var(--text-14)', fontWeight: 500, color: 'white' }}>
            <span style={{ background: 'rgba(255, 255, 255, 0.15)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255, 255, 255, 0.3)', color: 'white', padding: '1px 4px', borderRadius: '3px' }}>
              Parent Process
            </span>
            {' '}
            {parentId ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                <button
                  className="cds--link"
                  style={{ border: 'none', background: 'transparent', padding: 0, color: 'white', fontSize: 'var(--text-14)', fontWeight: 500 }}
                  onClick={() => tenantNavigate(`/mission-control/processes/instances/${parentId}`)}
                  title={parentId}
                >
                  {parentId.length > 15 ? `${parentId.slice(0, 6)}...${parentId.slice(-6)}` : parentId}
                </button>
                <button
                  style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  onClick={() => navigator.clipboard.writeText(parentId)}
                  title="Copy full parent process ID"
                >
                  <Copy size={16} style={{ fill: 'white' }} />
                </button>
              </div>
            ) : 'None'}
          </div>
          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.3)' }}></div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--spacing-2)' }}>
            {/* Suspend/Resume button */}
            {status === 'ACTIVE' ? (
              <Button
                hasIconOnly
                size="sm"
                kind="ghost"
                renderIcon={(props) => <Pause {...props} style={{ fill: 'white' }} />}
                iconDescription="Suspend process instance"
                onClick={onSuspend}
              />
            ) : status === 'SUSPENDED' ? (
              <Button
                hasIconOnly
                size="sm"
                kind="ghost"
                renderIcon={(props) => <Play {...props} style={{ fill: 'white' }} />}
                iconDescription="Resume process instance"
                onClick={onResume}
              />
            ) : (
              <Button
                hasIconOnly
                size="sm"
                kind="ghost"
                disabled
                renderIcon={(props) => <Pause {...props} style={{ fill: 'rgba(255, 255, 255, 0.3)' }} />}
                iconDescription="Process is completed"
              />
            )}
            
            {/* Modify button */}
            <Button
              hasIconOnly
              size="sm"
              kind="ghost"
              disabled={status === 'COMPLETED' || status === 'CANCELED' || status === 'EXTERNALLY_TERMINATED' || status === 'INTERNALLY_TERMINATED'}
              renderIcon={(props) => <WrenchIcon {...props} style={{ fill: status === 'COMPLETED' || status === 'EXTERNALLY_TERMINATED' || status === 'INTERNALLY_TERMINATED' ? 'rgba(255, 255, 255, 0.3)' : 'white' }} />}
              iconDescription={status === 'COMPLETED' || status === 'EXTERNALLY_TERMINATED' || status === 'INTERNALLY_TERMINATED' ? "Process is completed" : "Modify / fix this process instance"}
              onClick={onModify}
            />
            
            {/* Terminate button */}
            <Button
              hasIconOnly
              size="sm"
              kind="danger--ghost"
              disabled={status === 'COMPLETED' || status === 'CANCELED' || status === 'EXTERNALLY_TERMINATED' || status === 'INTERNALLY_TERMINATED'}
              renderIcon={(props) => <TrashCan {...props} style={{ fill: status === 'COMPLETED' || status === 'EXTERNALLY_TERMINATED' || status === 'INTERNALLY_TERMINATED' ? 'rgba(255, 255, 255, 0.3)' : 'white' }} />}
              iconDescription={status === 'COMPLETED' || status === 'EXTERNALLY_TERMINATED' || status === 'INTERNALLY_TERMINATED' ? "Process is completed" : "Cancel process instance"}
              onClick={onTerminate}
            />
          </div>
        </div>
        </div>
      </div>

      {/* Incident Banner */}
      {showIncidentBanner && (
        <div style={{ background: '#ffd7d9', color: '#a2191f', padding: '10px var(--spacing-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--color-border-primary)' }}>
          <div style={{ fontSize: 'var(--text-13)', fontWeight: 'var(--font-weight-semibold)' }}>
            {incidentCount} incident{incidentCount === 1 ? '' : 's'} occurred in this instance.
          </div>
          <div>
            <Button size="sm" kind="danger" onClick={onRetry}>
              Retry failed jobs & tasks
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
