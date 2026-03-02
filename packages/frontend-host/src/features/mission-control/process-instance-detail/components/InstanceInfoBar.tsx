import React from 'react'
import { Button } from '@carbon/react'
import { Pause, Play, TrashCan, Copy, Renew } from '@carbon/icons-react'
import styles from '../styles/InstanceDetail.module.css'
import { WrenchIcon } from './Icons'

type HistoryContext = {
  activityName?: string
  statusLabel?: string
  startTime?: string | null
  endTime?: string | null
  durationMs?: number | null
  executions?: number | null
}

interface InstanceInfoBarProps {
  historyContext: HistoryContext | null
  defName?: string
  instanceId: string
  defs: Array<{ key: string; version: number }>
  defKey?: string
  histData?: { startTime?: string; endTime?: string | null }
  parentId?: string | null
  status?: string
  showModifyAction: boolean
  fmt: (ts?: string | null) => string
  onNavigate: (path: string) => void
  onCopy: (value: string) => void
  onSuspend: () => void
  onResume: () => void
  onModify: () => void
  onTerminate: () => void
  onRetry?: () => void
  incidentCount?: number
}

export function InstanceInfoBar({
  historyContext,
  defName,
  instanceId,
  defs,
  defKey,
  histData,
  parentId,
  status,
  showModifyAction,
  fmt,
  onNavigate,
  onCopy,
  onSuspend,
  onResume,
  onModify,
  onTerminate,
  onRetry,
  incidentCount = 0,
}: InstanceInfoBarProps) {
  const latestVersion = (defs || [])
    .filter((d) => d.key === defKey)
    .map((d) => d.version)
    .sort((a, b) => b - a)[0]

  return (
    <div className={styles.infoBar}>
      <div className={styles.infoBarContent}>
        <div className={historyContext ? `${styles.infoBarGrid} ${styles.infoBarGridHistory}` : styles.infoBarGrid}>
          {historyContext ? (
            <>
              <div className={styles.infoBarText}>{historyContext.activityName || '—'}</div>
              <div className={styles.divider}></div>
              <div className={styles.infoBarText}>
                <span className={styles.badge}>Status</span>
                {' '}{historyContext.statusLabel || '—'}
              </div>
              <div className={styles.divider}></div>
              <div className={styles.infoBarText}>
                {(() => {
                  const start = historyContext.startTime ? fmt(historyContext.startTime) : '—'
                  const end = historyContext.endTime ? fmt(historyContext.endTime) : '—'
                  const ms = historyContext.durationMs
                  if (!ms || !Number.isFinite(ms) || ms < 0) {
                    return (
                      <>
                        <span className={styles.badge}>Start</span>
                        {' '}{start}
                        {'  '}
                        <span className={styles.badge}>End</span>
                        {' '}{end}
                      </>
                    )
                  }
                  const totalSeconds = Math.floor(ms / 1000)
                  const minutes = Math.floor(totalSeconds / 60)
                  const seconds = totalSeconds % 60
                  const duration = minutes <= 0 ? `${seconds}s` : `${minutes}m ${seconds}s`
                  return (
                    <>
                      <span className={styles.badge}>Start</span>
                      {' '}{start}
                      {'  '}
                      <span className={styles.badge}>End</span>
                      {' '}{end}
                      {'  '}({duration})
                    </>
                  )
                })()}
              </div>
              <div className={styles.divider}></div>
              <div className={styles.infoBarText}>
                <span className={styles.badge}>Executions</span>
                {' '}{historyContext.executions ?? '—'}
              </div>
              <div className={styles.divider}></div>
            </>
          ) : (
            <>
              <div className={styles.infoBarText}>{defName}</div>
              <div className={styles.divider}></div>
              <div className={styles.infoBarTextWithFlex}>
                <button
                  className={`cds--link ${styles.linkButton}`}
                  onClick={() => onNavigate(`/mission-control/processes/instances/${instanceId}`)}
                  title={instanceId}
                >
                  {instanceId.length > 15 ? `${instanceId.slice(0, 6)}...${instanceId.slice(-6)}` : instanceId}
                </button>
                <button
                  className={styles.iconButton}
                  onClick={() => onCopy(instanceId)}
                  title="Copy full instance ID"
                >
                  <Copy size={16} className={styles.iconButtonWhite} />
                </button>
              </div>
              <div className={styles.divider}></div>
              <div className={styles.infoBarText}>
                <span className={styles.badge}>ver.</span>
                {' '}{latestVersion || ''}
              </div>
              <div className={styles.divider}></div>
              <div className={styles.infoBarText}>
                {(() => {
                  const startTime = fmt(histData?.startTime)
                  const startDate = new Date(histData?.startTime || '')
                  const endTime = histData?.endTime ? fmt(histData?.endTime) : null
                  const endDate = histData?.endTime ? new Date(histData?.endTime) : new Date()
                  const diffMs = endDate.getTime() - startDate.getTime()
                  const diffMins = Math.floor(diffMs / 60000)
                  const days = Math.floor(diffMins / 1440)
                  const hours = Math.floor((diffMins % 1440) / 60)
                  const minutes = diffMins % 60
                  let duration = ''
                  if (days > 0) duration += `${days}d `
                  if (hours > 0 || days > 0) duration += `${hours}h `
                  duration += `${minutes}m`
                  if (endTime) {
                    return (
                      <>
                        <span className={styles.badge}>Started</span>
                        {' '}{startTime} to {endTime} ({duration.trim()})
                      </>
                    )
                  }
                  return (
                    <>
                      <span className={styles.badge}>Started</span>
                      {' '}{startTime} ({duration.trim()})
                    </>
                  )
                })()}
              </div>
              <div className={styles.divider}></div>
              <div className={styles.infoBarText}>
                <span className={styles.badge}>Parent Process</span>
                {' '}
                {parentId ? (
                  <div className={styles.inlineFlexContainer}>
                    <button
                      className={`cds--link ${styles.linkButton}`}
                      onClick={() => onNavigate(`/mission-control/processes/instances/${parentId}`)}
                      title={parentId}
                    >
                      {parentId.length > 15 ? `${parentId.slice(0, 6)}...${parentId.slice(-6)}` : parentId}
                    </button>
                    <button
                      className={styles.iconButton}
                      onClick={() => onCopy(parentId)}
                      title="Copy full parent process ID"
                    >
                      <Copy size={16} className={styles.iconButtonWhite} />
                    </button>
                  </div>
                ) : 'None'}
              </div>
              <div className={styles.divider}></div>
            </>
          )}
          <div className={styles.infoBarTextWithFlex} style={{ justifyContent: 'flex-end' }}>
            {onRetry && incidentCount > 0 && status !== 'COMPLETED' && status !== 'EXTERNALLY_TERMINATED' && status !== 'INTERNALLY_TERMINATED' && (
              <Button
                hasIconOnly
                size="sm"
                kind="ghost"
                renderIcon={(props) => <Renew {...props} className={styles.iconButtonWhite} />}
                iconDescription="Retry failed jobs & tasks"
                onClick={onRetry}
              />
            )}
            {status === 'ACTIVE' && (
              <Button
                hasIconOnly
                size="sm"
                kind="ghost"
                renderIcon={(props) => <Pause {...props} className={styles.iconButtonWhite} />}
                iconDescription="Suspend process instance"
                onClick={onSuspend}
              />
            )}
            {status === 'SUSPENDED' && (
              <Button
                hasIconOnly
                size="sm"
                kind="ghost"
                renderIcon={(props) => <Play {...props} className={styles.iconButtonWhite} />}
                iconDescription="Resume process instance"
                onClick={onResume}
              />
            )}
            {showModifyAction && status !== 'COMPLETED' && status !== 'EXTERNALLY_TERMINATED' && status !== 'INTERNALLY_TERMINATED' && (
              <Button
                hasIconOnly
                size="sm"
                kind="ghost"
                renderIcon={(props) => <WrenchIcon {...props} className={styles.iconButtonWhite} />}
                iconDescription="Modify / fix this process instance"
                onClick={onModify}
              />
            )}
            {status !== 'COMPLETED' && status !== 'EXTERNALLY_TERMINATED' && status !== 'INTERNALLY_TERMINATED' && (
              <Button
                hasIconOnly
                size="sm"
                kind="danger--ghost"
                renderIcon={(props) => <TrashCan {...props} className={styles.iconButtonWhite} />}
                iconDescription="Cancel process instance"
                onClick={onTerminate}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
