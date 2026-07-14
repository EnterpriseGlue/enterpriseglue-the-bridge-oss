import React from 'react';
import { InlineNotification } from '@carbon/react';

export type RuntimeCollectionKind = 'process_definitions' | 'decision_definitions' | 'process_instances' | 'batches' | 'migration_definitions';

const emptyStateCopy: Record<RuntimeCollectionKind, { title: string; subtitle: string }> = {
  process_definitions: {
    title: 'No visible process definitions',
    subtitle: 'This engine may have no deployments, or your access is limited to a different runtime resource set.',
  },
  decision_definitions: {
    title: 'No visible decision definitions',
    subtitle: 'This engine may have no deployed decisions, or your access is limited to a different runtime resource set.',
  },
  process_instances: {
    title: 'No visible process instances',
    subtitle: 'No authorized instances match the current filters, or the process definitions you can access have no instances.',
  },
  batches: {
    title: 'No visible batches',
    subtitle: 'This engine may have no batch history, or its batches belong to process definitions outside your authorized runtime resources.',
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
