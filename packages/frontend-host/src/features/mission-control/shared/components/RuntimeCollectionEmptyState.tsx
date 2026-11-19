import React from 'react';
import { InlineNotification } from '@carbon/react';

export type RuntimeCollectionKind = 'process_definitions' | 'decision_definitions' | 'process_instances' | 'batches' | 'migration_definitions';

const emptyStateCopy: Record<RuntimeCollectionKind, { title: string; subtitle: string }> = {
  process_definitions: {
    title: 'No processes to show',
    subtitle: 'Deploy a process to this engine or ask an administrator to share one with you.',
  },
  decision_definitions: {
    title: 'No decisions to show',
    subtitle: 'Deploy a decision to this engine or ask an administrator to share one with you.',
  },
  process_instances: {
    title: 'No visible process instances',
    subtitle: 'Try adjusting the filters or selecting another process.',
  },
  batches: {
    title: 'No batches to show',
    subtitle: 'Batch operations you can access will appear here.',
  },
  migration_definitions: {
    title: 'No visible migration processes',
    subtitle: 'Migration source and target choices include only process definitions you can access. This engine may have no matching deployments.',
  },
};

export function getRuntimeCollectionEmptyState(kind: RuntimeCollectionKind) {
  return emptyStateCopy[kind];
}

export function RuntimeCollectionEmptyState({ kind, style }: { kind: RuntimeCollectionKind; style?: React.CSSProperties }) {
  const copy = getRuntimeCollectionEmptyState(kind);
  return <InlineNotification kind="info" lowContrast hideCloseButton title={copy.title} subtitle={copy.subtitle} style={style} />;
}
