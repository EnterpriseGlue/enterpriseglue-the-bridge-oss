import React from 'react'
import type { ElementLinkInfo } from '../../../shared/components/viewer/viewerTypes'
import styles from '../styles/InstanceDetail.module.css'
import { LoadingState } from '../../../shared/components/LoadingState'
import { hasBpmnDiagramLayout } from '../../../shared/components/viewer/viewerUtils'
import { getUiErrorMessage } from '../../../../shared/api/apiErrorUtils'

const Viewer = React.lazy(() => import('../../../shared/components/Viewer'))

interface ProcessInstanceDiagramPaneProps {
  instanceId: string
  xml?: string | null
  isLoading?: boolean
  error?: unknown
  onReady: (api: any) => void
  onDiagramReset: () => void
  onElementNavigate: (linkInfo: ElementLinkInfo) => void
}

export function ProcessInstanceDiagramPane({
  instanceId,
  xml,
  isLoading = false,
  error,
  onReady,
  onDiagramReset,
  onElementNavigate,
}: ProcessInstanceDiagramPaneProps) {
  const hasLayout = hasBpmnDiagramLayout(xml)
  const diagramState = error
    ? {
        role: 'alert' as const,
        title: 'Diagram could not be loaded',
        description: getUiErrorMessage(error, 'The process definition XML request failed.'),
      }
    : !isLoading && !xml
      ? {
          role: 'status' as const,
          title: 'No BPMN diagram is available',
          description: 'The engine did not return BPMN XML for this process definition.',
        }
      : !isLoading && xml && !hasLayout
        ? {
            role: 'status' as const,
            title: 'Diagram layout unavailable',
            description: 'The deployed BPMN is executable, but it does not contain BPMN DI layout coordinates. Redeploy the model with diagram layout metadata to display it.',
          }
        : null

  return (
    <div className={styles.topPaneContainer}>
      <div className={styles.diagramContainer}>
        {isLoading && <LoadingState message="Loading diagram..." />}
        {diagramState && (
          <div className={styles.diagramState} role={diagramState.role}>
            <strong>{diagramState.title}</strong>
            <span>{diagramState.description}</span>
          </div>
        )}
        {!isLoading && !error && xml && hasLayout && (
          <React.Suspense
            fallback={<LoadingState message="Loading diagram..." />}
          >
            <Viewer
              key={instanceId}
              xml={xml}
              onReady={onReady}
              onDiagramReset={onDiagramReset}
              onElementNavigate={onElementNavigate}
            />
          </React.Suspense>
        )}
      </div>
    </div>
  )
}
