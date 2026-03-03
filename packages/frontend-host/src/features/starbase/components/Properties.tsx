import React from 'react'
import { TextInput, InlineNotification } from '@carbon/react'

export type SelectionInfo = { id: string; type: string; name?: string } | null

export default function Properties({ selection }: { selection: SelectionInfo }) {
  if (!selection) {
    return <InlineNotification title="No element selected" kind="info" lowContrast hideCloseButton />
  }
  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
      <TextInput id="prop-id" labelText="ID" value={selection.id} readOnly />
      <TextInput id="prop-type" labelText="Type" value={selection.type} readOnly />
      <TextInput id="prop-name" labelText="Name" value={selection.name || ''} placeholder="" readOnly />
    </div>
  )
}
