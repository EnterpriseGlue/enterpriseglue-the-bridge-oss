import React from 'react'
import type { ElementLinkInfo } from '../../../shared/components/viewer/viewerTypes'
import styles from '../styles/InstanceDetail.module.css'
import { LoadingState } from '../../../shared/components/LoadingState'

const Viewer = React.lazy(() => import('../../../shared/components/Viewer'))

interface ProcessInstanceDiagramPaneProps {
  instanceId: string
  xml?: string | null
  onReady: (api: any) => void
  onDiagramReset: () => void
  onElementNavigate: (linkInfo: ElementLinkInfo) => void
}

export function ProcessInstanceDiagramPane({
  instanceId,
  xml,
  onReady,
  onDiagramReset,
  onElementNavigate,
}: ProcessInstanceDiagramPaneProps) {
  return (
    <div className={styles.topPaneContainer}>
      <div className={styles.diagramContainer}>
        {xml && (
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
